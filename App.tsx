
import React, { useState, useRef } from 'react';
import { 
  AppState, 
  ComparisonRow,
  RequirementItem,
  ValidationStatus,
  ComponentInfo
} from './types';
import { analyzeRequirements, compareConfiguration, extractDcscComponents, generateConfigurationSupplement } from './services/geminiService';
import { StatusBadge } from './components/StatusBadge';
import { 
  ClipboardList, 
  Cpu, 
  Server, 
  ArrowRight, 
  Loader2, 
  Download, 
  Share2, 
  Upload, 
  Plus, 
  FileCheck, 
  Play,
  ExternalLink,
  LogIn,
  X,
  CheckCircle2,
  AlertCircle,
  Target,
  Users,
  BarChart3,
  BookOpen,
  CheckSquare,
  FileSpreadsheet,
  FileText
} from 'lucide-react';

const INITIAL_STATE: AppState & { configSupplement?: string } = {
  step: 'home',
  customerName: '',
  projectName: '',
  rawRequirements: '',
  rawConfig: '',
  configFileName: '',
  requirementResult: null,
  comparisonRows: [],
  extractedComponents: [],
  requirementReviewer: '',
  configAuthor: '',
  configReviewer: '',
  requirementCheckMap: {},
  groupNotes: {},
  isAnalyzing: false,
  error: null,
  configSupplement: '',
};

const LENOVO_LINKS = [
  { name: 'SR250 V3', url: 'https://us-dcsc.lenovo.com/#/configuration/cto/7DCLCTO1WW?hardwareType=server' },
  { name: 'SR630 V4', url: 'https://us-dcsc.lenovo.com/#/configuration/cto/7DG9CTO1WW?hardwareType=server' },
  { name: 'SR650 V4', url: 'https://us-dcsc.lenovo.com/#/configuration/cto/7DGDCTO1WW?hardwareType=server' },
  { name: 'ST50 V3', url: 'https://us-dcsc.lenovo.com/#/configuration/cto/7DF3CTO1WW?hardwareType=server' },
  { name: 'ST250 V3', url: 'https://us-dcsc.lenovo.com/#/configuration/cto/7DCECTO1WW?hardwareType=server' },
  { name: 'ST650 V3', url: 'https://us-dcsc.lenovo.com/#/categories/STG%40Servers%40Tower%20Server%40ThinkSystem%20ST650%20V3' },
];

const LOGIN_URL = 'https://www.lenovopartnerhub.com/group/japan-site';

function App() {
  const [state, setState] = useState<AppState & { configSupplement?: string }>(INITIAL_STATE);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const xmlInputRef = useRef<HTMLInputElement>(null);

  // --- Helpers ---

  const validateEssentialRequirements = (requirements: RequirementItem[]): string[] => {
    const essential = ["数量", "筐体", "CPU", "メモリ", "ストレージ", "保守"];
    const missing: string[] = [];
    
    const groups = Array.from(new Set(requirements.map(r => r.groupName)));
    
    groups.forEach(group => {
      const groupReqs = requirements.filter(r => r.groupName === group);
      essential.forEach(label => {
        const found = groupReqs.find(r => r.categoryLabel.includes(label) || label.includes(r.categoryLabel));
        if (!found || found.value === "未指定" || !found.value.trim()) {
          missing.push(`${group}の「${label}」`);
        }
      });
    });
    return missing;
  };

  /**
   * CSV出力ロジック
   * 管理SW、OS、保守 -> 製品番号列にPN、製品名列にName
   * それ以外 -> 製品番号列に製品名、製品名列は空
   */
  const downloadCsvFile = (components: ComponentInfo[], customerName: string) => {
    if (components.length === 0) return;

    const specialCategories = ["【管理SW】", "【OS】", "【保守】"];
    const allCategories = [
      "CPU", "MEM", "RAID", "Disk", "NIC(onboard)", "NIC(追加)", 
      "PowerSupply", "電源コード", "レールキット", "【管理SW】", "【OS】", "【保守】"
    ];

    let csvContent = "\uFEFF"; // UTF-8 BOM for Excel
    csvContent += "カテゴリー,製品番号,製品名,数量\n";

    allCategories.forEach(cat => {
      const items = components.filter(c => c.category === cat);
      if (items.length > 0) {
        items.forEach(item => {
          if (specialCategories.includes(cat)) {
            // 管理SW、OS、保守: 製品番号と製品名を分ける
            csvContent += `"${cat}","${item.partNumber}","${item.productName}","${item.quantity}"\n`;
          } else {
            // それ以外: 製品番号の列に製品名を入れる (製品名列は空)
            csvContent += `"${cat}","${item.productName}","","${item.quantity}"\n`;
          }
        });
      } else {
        csvContent += `"${cat}","","",""\n`;
      }
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Lenovo_ProductList_${customerName || 'Project'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  /**
   * 構成補足TXT出力
   */
  const handleDownloadSupplement = () => {
    if (!state.configSupplement) {
      alert("構成補足データがありません。");
      return;
    }
    
    // テキストファイルとして出力
    const blob = new Blob([state.configSupplement], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Lenovo_ConfigSupplement_${state.customerName || 'project'}.txt`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- Handlers ---

  const handleStartNew = () => {
    setState(prev => ({ ...prev, step: 'requirements' }));
    setValidationErrors([]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleRequirementAnalyze = async () => {
    if (!state.rawRequirements.trim()) return;
    setState(prev => ({ ...prev, isAnalyzing: true, error: null }));
    setValidationErrors([]);
    try {
      const result = await analyzeRequirements(state.rawRequirements);
      const errors = validateEssentialRequirements(result.requirements);
      
      setState(prev => ({
        ...prev,
        isAnalyzing: false,
        requirementResult: result,
        step: 'configuration' 
      }));
      setValidationErrors(errors);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setState(prev => ({ ...prev, isAnalyzing: false, error: err.message }));
    }
  };

  const handleRequirementUpdate = (index: number, field: keyof RequirementItem, text: string) => {
    if (!state.requirementResult) return;
    const newRequirements = [...state.requirementResult.requirements];
    newRequirements[index] = { ...newRequirements[index], [field]: text };
    
    setState(prev => ({
      ...prev,
      requirementResult: { ...prev.requirementResult!, requirements: newRequirements }
    }));
  };

  const handleGroupRename = (oldName: string, newName: string) => {
    if (!state.requirementResult) return;
    const newRequirements = state.requirementResult.requirements.map(req => 
      req.groupName === oldName ? { ...req, groupName: newName } : req
    );
    setState(prev => ({
      ...prev,
      requirementResult: { ...prev.requirementResult!, requirements: newRequirements }
    }));
  };

  const handleRequirementAdd = (groupName: string = '新規サーバ') => {
    if (!state.requirementResult) return;
    const newReq: RequirementItem = {
      categoryKey: `added-${Date.now()}`,
      categoryLabel: '項目名',
      value: '',
      groupName
    };
    setState(prev => ({
      ...prev,
      requirementResult: {
        ...prev.requirementResult!,
        requirements: [...prev.requirementResult!.requirements, newReq]
      }
    }));
  };

  const handleRequirementDelete = (index: number) => {
    if (!state.requirementResult) return;
    const newRequirements = [...state.requirementResult.requirements];
    newRequirements.splice(index, 1);
    setState(prev => ({
      ...prev,
      requirementResult: { ...prev.requirementResult!, requirements: newRequirements }
    }));
  };

  const handleRowUpdate = (id: string, field: keyof ComparisonRow, value: any) => {
    setState(prev => ({
      ...prev,
      comparisonRows: prev.comparisonRows.map(row => 
        row.id === id ? { ...row, [field]: value } : row
      )
    }));
  };

  const handleCompare = async () => {
    if (!state.requirementResult) return;
    
    const errors = validateEssentialRequirements(state.requirementResult.requirements);
    if (errors.length > 0) {
      setValidationErrors(errors);
      if(!window.confirm("必須要件が一部不足していますが、検証を続行しますか？")) return;
    }

    setState(prev => ({ ...prev, isAnalyzing: true, error: null }));
    try {
      const [rows, components, supplement] = await Promise.all([
        compareConfiguration(state.requirementResult.requirements, state.rawConfig),
        extractDcscComponents(state.rawConfig),
        generateConfigurationSupplement(state.rawConfig)
      ]);
      
      setState(prev => ({
        ...prev,
        isAnalyzing: false,
        comparisonRows: rows,
        extractedComponents: components,
        configSupplement: supplement,
        step: 'report'
      }));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setState(prev => ({ ...prev, isAnalyzing: false, error: err.message }));
    }
  };

  const processFile = (file: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setState(prev => ({ ...prev, rawConfig: content, configFileName: file.name }));
    };
    reader.readAsText(file);
  };

  const handleXmlUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handleDownloadPdf = async () => {
    const element = document.getElementById('report-container');
    if (!element) return;
    element.classList.add('pdf-mode');
    // @ts-ignore
    const worker = window.html2pdf();
    const opt = {
      margin:       [10, 10, 10, 10],
      filename:     `Lenovo_Report_${state.customerName || 'Project'}_${new Date().toISOString().slice(0,10)}.pdf`,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true, scrollY: 0 },
      jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
    };
    try {
      await worker.set(opt).from(element).save();
    } finally {
      element.classList.remove('pdf-mode');
    }
  };

  const handleDownloadCsv = () => {
    downloadCsvFile(state.extractedComponents, state.customerName);
  };

  const handleExportData = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `lenovo_data_${state.customerName || 'project'}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const handleImportData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileReader = new FileReader();
    if (e.target.files && e.target.files[0]) {
      fileReader.readAsText(e.target.files[0], "UTF-8");
      fileReader.onload = (event) => {
        try {
          if (event.target?.result) {
              const loadedState = JSON.parse(event.target.result as string);
              if (loadedState.step) {
                setState({ ...INITIAL_STATE, ...loadedState, isAnalyzing: false, error: null });
                setValidationErrors([]);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
          }
        } catch (err) {
          alert("ファイル読み込みに失敗しました。");
        }
      };
    }
  };

  // --- Rendering Helpers ---

  const groupedRequirements: Record<string, RequirementItem[]> = {};
  if (state.requirementResult) {
    state.requirementResult.requirements.forEach(req => {
      if (!groupedRequirements[req.groupName]) {
        groupedRequirements[req.groupName] = [];
      }
      groupedRequirements[req.groupName].push(req);
    });
  }

  const groupedComparisons: Record<string, ComparisonRow[]> = {};
  state.comparisonRows.forEach(row => {
    if (!groupedComparisons[row.groupName]) {
      groupedComparisons[row.groupName] = [];
    }
    groupedComparisons[row.groupName].push(row);
  });

  const getStats = () => {
    const total = state.comparisonRows.length;
    const ok = state.comparisonRows.filter(r => r.status === ValidationStatus.OK).length;
    const ng = state.comparisonRows.filter(r => r.status === ValidationStatus.NG).length;
    const warn = state.comparisonRows.filter(r => r.status === ValidationStatus.WARN).length;
    return { total, ok, ng, warn };
  };

  const renderHome = () => (
    <div className="animate-in fade-in duration-700">
      <div className="bg-white border border-slate-200 rounded-3xl p-8 sm:p-16 shadow-xl mb-12 relative overflow-hidden">
        <div className="relative z-10 max-w-3xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-red-600 p-2 rounded-lg shadow-lg shadow-red-200"><Cpu className="w-8 h-8 text-white" /></div>
            <span className="text-red-600 font-bold tracking-widest text-sm uppercase">Lenovo Expert Automation</span>
          </div>
          <h1 className="text-4xl sm:text-6xl font-extrabold mb-6 leading-tight text-slate-900">
            Lenovo構成確認の<br/><span className="text-red-600">自動化・レポート生成</span>
          </h1>
          <p className="text-lg text-slate-600 mb-10 leading-relaxed">
            Gemini AIにより、スペック確認を自動化。構成XMLの検証からPDFレポート・製品CSV出力まで一貫してサポートします。
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <button onClick={handleStartNew} className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white px-8 py-4 rounded-xl font-bold text-lg transition-all shadow-lg shadow-red-500/20">
              <Play size={20} fill="currentColor" />新規検証プロセスを開始
            </button>
            <button onClick={() => fileInputRef.current?.click()} className="flex items-center justify-center gap-2 bg-white hover:bg-slate-50 text-slate-700 px-8 py-4 rounded-xl font-bold text-lg transition-all border border-slate-300">
              <Upload size={20} />保存済みデータの読込
            </button>
          </div>
        </div>
        <div className="absolute top-0 right-0 -mr-16 -mt-16 bg-slate-50 w-64 h-64 rounded-full blur-3xl opacity-50"></div>
      </div>
    </div>
  );

  const renderRequirementsInput = () => (
    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
      <div className="bg-white p-10 rounded-3xl shadow-xl border border-slate-200">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-black text-slate-500 uppercase tracking-wider"><Users size={16} /> 顧客名</label>
                <input 
                    type="text" 
                    placeholder="株式会社〇〇 様" 
                    className="w-full p-4 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-red-500 outline-none font-bold"
                    value={state.customerName}
                    onChange={(e) => setState(prev => ({...prev, customerName: e.target.value}))}
                />
            </div>
            <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-black text-slate-500 uppercase tracking-wider"><Target size={16} /> 案件名</label>
                <input 
                    type="text" 
                    placeholder="次期基盤サーバー更新" 
                    className="w-full p-4 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-red-500 outline-none font-bold"
                    value={state.projectName}
                    onChange={(e) => setState(prev => ({...prev, projectName: e.target.value}))}
                />
            </div>
        </div>

        <h2 className="text-2xl font-bold mb-6 flex items-center gap-3 text-slate-900"><ClipboardList className="text-red-600" />1. 要件テキストの入力</h2>
        <p className="text-slate-600 text-sm mb-4 leading-relaxed">
          メールや提案依頼書から、要件部分をコピーして貼り付けてください。AIが構成グループを自動作成します。
        </p>
        <textarea
          className="w-full h-64 p-6 border border-slate-200 rounded-2xl bg-slate-50 focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none font-mono text-sm transition-all shadow-inner"
          placeholder="例：Webサーバー3台(SR630), WinServer2022, Xeon Gold, メモリ64GB, 2.5インチ1.2TBx2 RAID1, 3年24x7保守..."
          value={state.rawRequirements}
          onChange={(e) => setState(prev => ({ ...prev, rawRequirements: e.target.value, requirementResult: null }))}
        />

        <div className="mt-8 flex justify-between items-center">
          <button onClick={() => setState(INITIAL_STATE)} className="text-slate-500 text-sm font-bold hover:text-slate-800 transition-colors">← ホームに戻る</button>
          <button 
            onClick={handleRequirementAnalyze} 
            disabled={state.isAnalyzing || !state.rawRequirements} 
            className="flex items-center gap-3 bg-red-600 text-white px-12 py-4 rounded-2xl font-black shadow-lg hover:bg-red-700 transition-all active:scale-95 disabled:opacity-50"
          >
            {state.isAnalyzing ? <Loader2 className="animate-spin" /> : <ArrowRight size={20} />}AI構成抽出を実行
          </button>
        </div>
      </div>
    </div>
  );

  const renderConfigurationInput = () => (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2"><BookOpen size={24} className="text-red-600" /> ステップ2: 構成データの紐付け</h2>
          <div className="flex gap-3 no-print">
            <button onClick={handleExportData} className="flex items-center gap-2 px-6 py-2 border border-slate-300 rounded-xl bg-white text-slate-700 font-bold shadow-sm hover:bg-slate-50 transition-colors"><Share2 size={18} />中断(保存)</button>
          </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Requirement Editor */}
        <div className="lg:col-span-2 bg-white p-8 rounded-3xl shadow-xl border border-slate-200">
            <div className="flex justify-between items-center mb-6">
              <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-2"><Target size={18} className="text-red-600" /> スペック詳細 調整</h4>
              <button 
                onClick={() => handleRequirementAdd()} 
                className="text-xs font-black bg-slate-900 text-white px-4 py-2 rounded-xl flex items-center gap-1 hover:bg-slate-800 transition-all"
              >
                <Plus size={14} /> サーバを追加
              </button>
            </div>

            <div className="space-y-6 max-h-[600px] overflow-y-auto pr-4 scrollbar-thin scrollbar-thumb-slate-200">
              {(Object.entries(groupedRequirements) as [string, RequirementItem[]][]).map(([group, reqs]) => (
                <div key={group} className="bg-slate-50 border border-slate-200 p-6 rounded-2xl shadow-sm space-y-4">
                  <div className="flex justify-between items-center border-b border-slate-200 pb-3">
                    <div className="flex items-center gap-2 text-sm font-black text-slate-900 flex-1">
                      <Server size={18} className="text-red-600"/> 
                      <input 
                        type="text" 
                        className="bg-transparent border-none focus:ring-0 font-black p-0 w-full" 
                        value={group} 
                        onChange={(e) => handleGroupRename(group, e.target.value)}
                        placeholder="サーバーグループ名"
                      />
                    </div>
                    <button 
                      onClick={() => handleRequirementAdd(group)}
                      className="text-[10px] font-black bg-white border border-slate-200 text-slate-600 px-3 py-1 rounded-lg flex items-center gap-1 hover:bg-slate-100 transition-all ml-2"
                    >
                      <Plus size={12} /> 項目を追加
                    </button>
                  </div>
                  <div className="space-y-3">
                    {reqs.map(r => {
                      const originalIdx = state.requirementResult!.requirements.findIndex(req => req.categoryKey === r.categoryKey);
                      const isEssential = ["数量", "CPU", "メモリ", "ストレージ", "保守", "OS", "筐体"].some(ess => r.categoryLabel.includes(ess));
                      const isMissing = isEssential && (r.value === "未指定" || !r.value.trim());
                      
                      return (
                        <div key={r.categoryKey} className="grid grid-cols-12 gap-3 items-center group">
                          <input 
                            className={`col-span-4 text-xs border rounded-xl px-3 py-2 font-bold focus:ring-2 focus:ring-red-500 outline-none transition-all ${isMissing ? 'bg-red-50 border-red-200 text-red-900' : 'bg-white border-slate-200 text-slate-700'}`}
                            value={r.categoryLabel}
                            onChange={(e) => handleRequirementUpdate(originalIdx, 'categoryLabel', e.target.value)}
                          />
                          <input 
                            className={`col-span-7 text-xs border rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-red-500 outline-none transition-all ${isMissing ? 'bg-red-50 border-red-400 placeholder-red-300' : 'bg-white border-slate-200'}`}
                            value={r.value}
                            placeholder={isMissing ? "要件を入力してください" : ""}
                            onChange={(e) => handleRequirementUpdate(originalIdx, 'value', e.target.value)}
                          />
                          <button onClick={() => handleRequirementDelete(originalIdx)} className="col-span-1 text-slate-300 hover:text-red-500 transition-colors flex justify-center"><X size={16} /></button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
        </div>

        {/* Config Linker */}
        <div className="space-y-6">
            <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-200">
                <h2 className="text-xl font-bold mb-6 flex items-center gap-3 text-slate-900"><LogIn className="text-red-600" /> 構成の取り込み</h2>
                <div className="space-y-6">
                    <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
                        <p className="text-xs font-black text-slate-400 uppercase mb-3">1. 構成案を作成</p>
                        <a href={LOGIN_URL} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full bg-slate-900 text-white px-6 py-4 rounded-xl font-bold hover:bg-black shadow-lg transition-all text-sm mb-4">
                            Partner Hubログイン <ExternalLink size={16} />
                        </a>
                        <div className="grid grid-cols-2 gap-2">
                            {LENOVO_LINKS.map(link => (
                            <a key={link.name} href={link.url} target="_blank" rel="noopener noreferrer" className="bg-white border border-slate-200 p-2 rounded-lg hover:bg-red-50 text-[10px] font-bold text-slate-800 flex justify-between items-center">
                                {link.name} <ExternalLink size={10} />
                            </a>
                            ))}
                        </div>
                    </div>

                    <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
                        <p className="text-xs font-black text-slate-400 uppercase mb-3">2. XMLをアップロード</p>
                        <div 
                            className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${isDragging ? 'border-red-600 bg-red-50 shadow-[0_0_20px_rgba(220,38,38,0.2)]' : state.configFileName ? 'border-green-500 bg-green-50' : 'border-slate-300 hover:border-red-400 hover:bg-slate-100'}`}
                            onClick={() => xmlInputRef.current?.click()}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                        >
                            <input type="file" ref={xmlInputRef} style={{ display: 'none' }} accept=".xml" onChange={handleXmlUpload} />
                            {state.configFileName ? (
                                <div>
                                    <CheckCircle2 className="mx-auto text-green-500 mb-2" size={32} />
                                    <p className="text-xs font-bold text-green-700 truncate px-2">{state.configFileName}</p>
                                </div>
                            ) : (
                                <div>
                                    <Upload className={`mx-auto mb-2 ${isDragging ? 'text-red-600 scale-110' : 'text-slate-400'} transition-transform`} size={32} />
                                    <p className="text-xs font-bold text-slate-500">DCSCのXMLファイルをドロップまたはクリック</p>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase ml-1">構成作成者</label>
                        <input 
                            type="text" 
                            placeholder="担当者名" 
                            className="w-full p-4 border border-slate-200 rounded-2xl bg-white focus:ring-2 focus:ring-red-500 outline-none font-bold text-sm"
                            value={state.configAuthor}
                            onChange={(e) => setState(prev => ({ ...prev, configAuthor: e.target.value }))}
                        />
                    </div>
                </div>

                <button 
                    onClick={handleCompare} 
                    disabled={state.isAnalyzing || !state.rawConfig || !state.configAuthor.trim()} 
                    className="mt-8 flex items-center justify-center gap-4 w-full bg-red-600 text-white px-8 py-5 rounded-2xl font-black shadow-lg hover:bg-red-700 transition-all disabled:opacity-50 active:scale-95"
                >
                    {state.isAnalyzing ? <Loader2 className="animate-spin" /> : <FileCheck size={24} />}検証を実行
                </button>
            </div>
        </div>
      </div>
    </div>
  );

  const renderReport = () => {
    const stats = getStats();
    
    return (
        <div className="space-y-6 animate-in fade-in duration-700">
          <div className="no-print flex justify-between items-center mb-8">
             <button onClick={() => setState(prev => ({ ...prev, step: 'configuration' }))} className="text-slate-500 text-sm font-bold hover:text-slate-800 transition-colors flex items-center gap-2"><ArrowRight size={16} className="rotate-180" /> 構成入力に戻る</button>
              <div className="flex gap-3">
                 <button onClick={handleExportData} className="flex items-center gap-2 px-6 py-2 border border-slate-300 rounded-xl bg-white text-slate-700 font-bold shadow-sm hover:bg-slate-50"><Share2 size={18} />保存</button>
                <button onClick={handleDownloadCsv} className="flex items-center gap-2 px-6 py-2 bg-slate-900 text-white rounded-xl font-bold shadow-lg hover:bg-black"><FileSpreadsheet size={18} />製品CSV出力</button>
                <button onClick={handleDownloadSupplement} className="flex items-center gap-2 px-6 py-2 bg-slate-100 text-slate-700 rounded-xl font-bold shadow-lg hover:bg-slate-200 border border-slate-300"><FileText size={18} />構成補足出力 (TXT)</button>
                <button onClick={handleDownloadPdf} className="flex items-center gap-3 bg-red-600 text-white px-10 py-3 rounded-xl font-black shadow-xl hover:bg-red-700 transition-all"><Download size={18} />PDFレポート出力</button>
              </div>
          </div>

          <div id="report-container" className="bg-white p-12 shadow-2xl border border-slate-200 max-w-6xl mx-auto rounded-[2rem] overflow-hidden">
            {/* Report Header */}
            <div className="border-b-4 border-slate-900 pb-10 mb-10 flex justify-between items-end">
              <div>
                <div className="flex items-center gap-2 mb-4 text-red-600">
                   <div className="bg-red-600 p-1.5 rounded-lg"><Cpu size={24} className="text-white" /></div>
                   <span className="font-black text-xl tracking-tighter uppercase">Lenovo Expert Config Validator</span>
                </div>
                <h1 className="text-5xl font-black text-slate-900 mb-4">構成確認検証レポート</h1>
                <div className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm">
                    <div className="flex justify-between border-b border-slate-100 py-1"><span className="text-slate-400 font-bold">顧客名</span><span className="font-black">{state.customerName || '未指定'}</span></div>
                    <div className="flex justify-between border-b border-slate-100 py-1"><span className="text-slate-400 font-bold">発行日</span><span className="font-black">{new Date().toLocaleDateString('ja-JP')}</span></div>
                    <div className="flex justify-between border-b border-slate-100 py-1"><span className="text-slate-400 font-bold">案件名</span><span className="font-black">{state.projectName || '未指定'}</span></div>
                    <div className="flex justify-between border-b border-slate-100 py-1"><span className="text-slate-400 font-bold">検証担当</span><span className="font-black">{state.configAuthor}</span></div>
                </div>
              </div>
              <div className="flex flex-col items-center">
                  <div className={`text-3xl font-black border-8 px-8 py-4 mb-2 ${stats.ng > 0 ? 'border-red-600 text-red-600' : 'border-green-600 text-green-600'} rotate-[-3deg]`}>
                    {stats.ng > 0 ? 'REJECTED' : 'APPROVED'}
                  </div>
                  <span className="text-[10px] font-black text-slate-400 tracking-[0.2em]">VALIDATION STAMP</span>
              </div>
            </div>

            <div className="space-y-12">
              {/* Executive Summary Dashboard */}
              <div className="grid grid-cols-4 gap-4 break-inside-avoid">
                  <div className="bg-slate-900 text-white p-6 rounded-2xl flex flex-col items-center justify-center">
                      <span className="text-[10px] font-black uppercase tracking-widest mb-1 opacity-50">Total Check</span>
                      <span className="text-3xl font-black">{stats.total}</span>
                  </div>
                  <div className="bg-green-50 border-2 border-green-200 p-6 rounded-2xl flex flex-col items-center justify-center">
                      <span className="text-[10px] font-black uppercase tracking-widest mb-1 text-green-600">Spec Match</span>
                      <span className="text-3xl font-black text-green-700">{stats.ok}</span>
                  </div>
                  <div className="bg-amber-50 border-2 border-amber-200 p-6 rounded-2xl flex flex-col items-center justify-center">
                      <span className="text-[10px] font-black uppercase tracking-widest mb-1 text-amber-600">Caution</span>
                      <span className="text-3xl font-black text-amber-700">{stats.warn}</span>
                  </div>
                  <div className="bg-red-50 border-2 border-red-200 p-6 rounded-2xl flex flex-col items-center justify-center">
                      <span className="text-[10px] font-black uppercase tracking-widest mb-1 text-red-600">Conflict</span>
                      <span className="text-3xl font-black text-red-700">{stats.ng}</span>
                  </div>
              </div>

              {/* Comparison Tables */}
              {(Object.entries(groupedComparisons) as [string, ComparisonRow[]][]).map(([group, rows]) => (
                <div key={group} className="break-inside-avoid space-y-4">
                  <h2 className="text-xl font-black text-slate-900 px-4 py-2 border-l-8 border-red-600 flex items-center gap-3">
                    <Server size={22} className="text-red-600" /> {group} 検証詳細
                  </h2>
                  <div className="overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-900 text-slate-400 border-b border-slate-800 uppercase font-black text-[9px] tracking-widest">
                          <th className="p-4 w-[15%]">検証項目</th>
                          <th className="p-4 w-[20%]">顧客要件</th>
                          <th className="p-4 w-[20%]">構成案スペック</th>
                          <th className="p-4 w-[10%] text-center">AI判定</th>
                          <th className="p-4 w-[10%] text-center">チェック</th>
                          <th className="p-4 w-[25%]">補足事項 (手動入力)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {rows.map((row) => (
                          <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                            <td className="p-4 font-black text-slate-900">{row.categoryLabel}</td>
                            <td className="p-4 text-slate-600 font-medium whitespace-pre-wrap">{row.requirementValue}</td>
                            <td className="p-4 font-bold text-slate-800">{row.configValue}</td>
                            <td className="p-4 text-center"><StatusBadge status={row.status} /></td>
                            <td className="p-4 text-center">
                                <button 
                                  onClick={() => handleRowUpdate(row.id, 'humanChecked', !row.humanChecked)}
                                  className={`p-2 rounded-lg transition-all ${row.humanChecked ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-300 hover:text-slate-400'}`}
                                >
                                  <CheckSquare size={20} fill={row.humanChecked ? "currentColor" : "none"} />
                                </button>
                            </td>
                            <td className="p-4">
                                <input 
                                    type="text"
                                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[10px] font-bold outline-none focus:ring-1 focus:ring-red-500 placeholder:font-normal placeholder:text-slate-300"
                                    placeholder="特記事項があれば入力..."
                                    value={row.remarks || ''}
                                    onChange={(e) => handleRowUpdate(row.id, 'remarks', e.target.value)}
                                />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}

              {/* Approval Footer */}
              <div className="mt-20 border-t-2 border-slate-100 pt-10 flex justify-end gap-12 break-inside-avoid">
                <div className="border border-slate-200 p-6 h-36 w-52 flex flex-col justify-between rounded-2xl bg-slate-50">
                  <span className="text-[10px] text-slate-400 font-black uppercase border-b pb-2 text-center">検証作成者</span>
                  <span className="text-center font-bold text-slate-900 text-lg">{state.configAuthor}</span>
                </div>
                <div className="border-4 border-slate-900 p-6 h-36 w-52 flex flex-col justify-between rounded-2xl bg-white shadow-xl relative overflow-hidden">
                   <div className="absolute top-0 left-0 w-full h-1 bg-red-600"></div>
                   <span className="text-[10px] text-slate-900 font-black uppercase border-b border-slate-900 pb-2 text-center">最終承認印</span>
                   <input 
                        type="text" 
                        className="no-print pdf-hide text-center font-black outline-none text-2xl text-red-600" 
                        placeholder="氏名を入力" 
                        value={state.configReviewer} 
                        onChange={(e) => setState(prev => ({...prev, configReviewer: e.target.value}))} 
                    />
                   <div className="hidden pdf-show text-center font-black text-2xl text-red-600">{state.configReviewer}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
    );
  };

  return (
    <div className="min-h-screen pb-12 bg-[#F8FAFC] text-slate-900 font-sans">
      <input type="file" ref={fileInputRef} style={{display: 'none'}} accept=".json" onChange={handleImportData} />
      
      {/* Navigation Header */}
      <header className="bg-white border-b border-slate-200 py-6 sticky top-0 z-50 no-print">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-4 cursor-pointer group" onClick={() => setState(INITIAL_STATE)}>
            <div className="bg-red-600 p-2 rounded-xl shadow-lg shadow-red-100 group-hover:scale-110 transition-transform">
                <Cpu className="w-6 h-6 text-white" />
            </div>
            <div className="flex flex-col">
                <span className="font-black text-2xl tracking-tighter leading-none">Lenovo <span className="text-red-600">Config</span></span>
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">Expert Automation Tool</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
              <button onClick={() => fileInputRef.current?.click()} className="text-xs font-black text-slate-500 hover:text-red-600 flex items-center gap-2 px-4 py-2 rounded-xl hover:bg-red-50 transition-all border border-transparent hover:border-red-100"><Upload size={16} /> 保存データの読込</button>
          </div>
        </div>
      </header>

      <main className={`max-w-6xl mx-auto px-6 ${state.step === 'home' ? 'mt-12' : 'mt-10'}`}>
        {state.step !== 'home' && (
          <div className="no-print mb-12 flex items-center justify-center gap-6">
            <div className={`flex flex-col items-center gap-2 transition-all ${state.step === 'requirements' ? 'opacity-100 scale-110' : 'opacity-40'}`}>
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg border-4 ${state.step === 'requirements' ? 'bg-red-600 border-red-200 text-white shadow-xl' : 'bg-white border-slate-200 text-slate-400'}`}>1</div>
                <span className="text-[10px] font-black uppercase tracking-widest">要件定義</span>
            </div>
            <div className="w-16 h-1 bg-slate-200 rounded-full"></div>
            <div className={`flex flex-col items-center gap-2 transition-all ${state.step === 'configuration' ? 'opacity-100 scale-110' : 'opacity-40'}`}>
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg border-4 ${state.step === 'configuration' ? 'bg-red-600 border-red-200 text-white shadow-xl' : 'bg-white border-slate-200 text-slate-400'}`}>2</div>
                <span className="text-[10px] font-black uppercase tracking-widest">構成貼合</span>
            </div>
            <div className="w-16 h-1 bg-slate-200 rounded-full"></div>
            <div className={`flex flex-col items-center gap-2 transition-all ${state.step === 'report' ? 'opacity-100 scale-110' : 'opacity-40'}`}>
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg border-4 ${state.step === 'report' ? 'bg-red-600 border-red-200 text-white shadow-xl' : 'bg-white border-slate-200 text-slate-400'}`}>3</div>
                <span className="text-[10px] font-black uppercase tracking-widest">検証結果</span>
            </div>
          </div>
        )}

        {state.error && (
            <div className="bg-red-50 border-2 border-red-200 p-6 rounded-3xl mb-8 flex items-center gap-4 animate-in shake duration-500">
                <AlertCircle className="text-red-600 shrink-0" size={32} />
                <div className="flex-1">
                    <p className="font-black text-red-900">エラーが発生しました</p>
                    <p className="text-sm text-red-700">{state.error}</p>
                </div>
                <button onClick={() => setState(prev => ({...prev, error: null}))} className="p-2 hover:bg-red-100 rounded-full text-red-400"><X size={20} /></button>
            </div>
        )}

        {state.step === 'home' && renderHome()}
        {state.step === 'requirements' && renderRequirementsInput()}
        {state.step === 'configuration' && renderConfigurationInput()}
        {state.step === 'report' && renderReport()}
      </main>

      <footer className="mt-20 py-12 border-t border-slate-200 text-center no-print text-slate-400 text-[10px] font-black tracking-[0.3em] uppercase">
          © 2025 Lenovo Config Automation | Expert Decision Support System
      </footer>
    </div>
  );
}

export default App;
