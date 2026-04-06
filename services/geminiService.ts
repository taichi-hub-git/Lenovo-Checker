
import { GoogleGenAI, Type } from "@google/genai";
import { ComparisonRow, RequirementAnalysisResult, ValidationStatus, ComponentInfo } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const MODEL_NAME = 'gemini-2.5-flash';

/**
 * Analyzes raw requirement text and extracts specs grouped by server type/role.
 * Summarizes values into concise bullet-point style strings.
 */
export const analyzeRequirements = async (text: string): Promise<RequirementAnalysisResult> => {
  if (!text.trim()) throw new Error("要件テキストが空です。");

  const systemInstruction = `
    あなたはLenovo製品（ThinkSystem, ThinkStation等）の構成構成確認のエキスパートです。
    ユーザーの要件テキストを解析し、サーバー/ワークステーションごとのスペック抽出を行ってください。
    
    【抽出・要約ルール】
    - 各スペック項目の値（value）は、内容を要約し、可能であれば簡潔な箇条書き（リスト形式）のように短くまとめてください。
    - 冗長な説明は省き、型番、容量、数量などのキー情報を中心に記載してください。
    - 複数の異なる構成がある場合は 'groupName' で分類してください。
    - 数量, 筐体, CPU, メモリ, ストレージ, OS, 保守を必須項目として抽出してください。
  `;

  const schema = {
    type: Type.OBJECT,
    properties: {
      serverGroups: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            groupName: { type: Type.STRING, description: "サーバーの役割や名前" },
            specs: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING, description: "項目名" },
                  value: { type: Type.STRING, description: "要約されたスペック値（箇条書き風）" }
                },
                required: ["label", "value"]
              }
            }
          },
          required: ["groupName", "specs"]
        }
      }
    },
    required: ["serverGroups"]
  };

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `以下の要件テキストを解析し、スペックを箇条書きで要約してください:\n\n${text}`,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0.1,
      }
    });

    const result = JSON.parse(response.text || "{}");
    const finalRequirements: any[] = [];

    result.serverGroups?.forEach((group: any) => {
      group.specs.forEach((spec: any, idx: number) => {
        finalRequirements.push({
          categoryKey: `${group.groupName}-${spec.label}-${idx}-${Date.now()}`,
          categoryLabel: spec.label,
          value: spec.value,
          groupName: group.groupName
        });
      });
    });

    return {
      isValid: finalRequirements.length > 0,
      missingCategories: [],
      requirements: finalRequirements
    };

  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    throw new Error("要件の解析に失敗しました。Geminiの接続を確認してください。");
  }
};

/**
 * Compares grouped requirements against configuration XML/Text.
 */
export const compareConfiguration = async (
  requirements: any[], 
  configText: string
): Promise<ComparisonRow[]> => {
  if (!configText.trim()) throw new Error("構成情報が空です。");

  const reqJson = JSON.stringify(requirements);

  const systemInstruction = `
    あなたはLenovo構成確認のエキスパートです。
    提供された要件(JSON)と、構成案(XMLまたはテキスト)を厳格に比較してください。

    【判定ロジック】
    - OK: 要件を完全に満たしている、またはスペックが上回っている。
    - WARN: 注意が必要。スペックが大幅に上回っている、または型番から判断が難しい。
    - NG: 要件未達。数量不足、OS違い、保守期間不足など。
    
    【出力】
    各 categoryKey に対して、構成から読み取った値(configValue)、判定(status)、理由(comment)を返してください。
  `;

  const schema = {
    type: Type.OBJECT,
    properties: {
      comparisons: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            categoryKey: { type: Type.STRING },
            configValue: { type: Type.STRING },
            status: { type: Type.STRING, enum: ["OK", "NG", "WARN"] },
            comment: { type: Type.STRING }
          },
          required: ["categoryKey", "configValue", "status", "comment"]
        }
      }
    },
    required: ["comparisons"]
  };

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `[要件データ]:\n${reqJson}\n\n[構成案データ (XML/TEXT)]:\n${configText}`,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0.1
      }
    });

    const result = JSON.parse(response.text || "{}");
    
    return requirements.map(req => {
      const match = result.comparisons?.find((c: any) => c.categoryKey === req.categoryKey);
      return {
        id: req.categoryKey,
        groupName: req.groupName,
        categoryLabel: req.categoryLabel,
        requirementValue: req.value,
        configValue: match ? match.configValue : "構成データ内に見当たりません",
        status: match ? (match.status as ValidationStatus) : ValidationStatus.NG,
        aiComment: match ? match.comment : "該当項目の抽出に失敗しました。手動で確認してください。",
        humanChecked: false,
        remarks: ""
      };
    });
  } catch (error) {
    console.error("Comparison Error:", error);
    throw new Error("構成の比較検証に失敗しました。");
  }
};

/**
 * Extracts product details for CSV output from DCSC XML.
 */
export const extractDcscComponents = async (xmlText: string): Promise<ComponentInfo[]> => {
  if (!xmlText.trim()) return [];

  const systemInstruction = `
    あなたはLenovo DCSC XMLの解析エキスパートです。
    XMLからカテゴリーに該当する構成部品を抽出し、JSON形式で返してください。
    カテゴリーは [CPU, MEM, RAID, Disk, NIC(onboard), NIC(追加), PowerSupply, 電源コード, レールキット, 【管理SW】, 【OS】, 【保守】] のいずれかから選択してください。
  `;

  const schema = {
    type: Type.OBJECT,
    properties: {
      components: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            category: { type: Type.STRING },
            partNumber: { type: Type.STRING },
            productName: { type: Type.STRING },
            quantity: { type: Type.STRING }
          },
          required: ["category", "partNumber", "productName", "quantity"]
        }
      }
    },
    required: ["components"]
  };

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `以下のXMLデータから構成部品を抽出してください:\n\n${xmlText}`,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0.1
      }
    });

    const result = JSON.parse(response.text || "{}");
    return result.components || [];
  } catch (error) {
    return [];
  }
};

/**
 * Generates Configuration Supplement text based on the user's specific template.
 */
export const generateConfigurationSupplement = async (xmlText: string): Promise<string> => {
  if (!xmlText.trim()) return "";

  const systemInstruction = `
    あなたはLenovo構成の技術担当者です。
    DCSCのXMLデータから情報を抽出し、以下の【構成補足】テンプレートを完成させてください。
    
    【構成補足】
    ※トップチョイスモードでの構成ですorではないです+理由
    機種：
    CPU：
    メモリ：
    ディスク：（事前設定時はRAIDレベル記載）（HSありorなし）
    RAIDコントローラー：
    NIC標準：
    NIC追加：
    ドライブ：
    電源：（100V確認）
    ラインコード：（100V確認)
    ラックレール：
    保守：（不要なものチェック入っていないか）
    OS：（プリロードorドロップインボックス）
    XCC：
    その他：（可能な機種はCMA）（その他ご要望があれば）

    【ルール】
    - 出力は上記のテンプレートそのままのテキスト形式にしてください。
    - 各項目について、XMLから読み取れる情報を記載してください。
    - トップチョイスかどうかは型番や構成のフラグから推測してください。
    - 100V確認は、日本向けの電源コード(LV-コード等)や電源ユニットの仕様から判断してください。
    - 不明な項目は「-」または「未確認」と記載してください。
  `;

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `以下のXMLから構成補足を作成してください:\n\n${xmlText}`,
      config: {
        systemInstruction,
        temperature: 0.1
      }
    });

    return response.text || "";
  } catch (error) {
    console.error("Supplement Generation Error:", error);
    return "構成補足の生成に失敗しました。";
  }
};
