
export enum ValidationStatus {
  OK = 'OK',
  NG = 'NG',
  WARN = 'WARN', // For over-spec or partial match
  UNKNOWN = 'UNKNOWN'
}

export interface SpecCategory {
  key: string;
  label: string;
}

export const REQUIRED_CATEGORIES: SpecCategory[] = [
  { key: 'quantity', label: '数量 (台数)' },
  { key: 'formFactor', label: '筐体タイプ (ラック型/タワー型)' },
  { key: 'cpu', label: 'CPU' },
  { key: 'memory', label: 'メモリ' },
  { key: 'storage', label: 'ストレージ' },
  { key: 'os', label: 'OS' },
  { key: 'support', label: '保守サポート' },
];

// Phase 1: Requirement Analysis
export interface RequirementItem {
  categoryKey: string;
  categoryLabel: string;
  value: string;
  groupName: string; // To distinguish between multiple servers (e.g., "Web Server", "DB Server")
}

export interface RequirementAnalysisResult {
  isValid: boolean;
  missingCategories: string[];
  requirements: RequirementItem[];
}

// Phase 2: Comparison
export interface ComparisonRow {
  id: string;
  groupName: string;
  categoryLabel: string;
  requirementValue: string;
  configValue: string;
  status: ValidationStatus;
  aiComment: string;
  humanChecked: boolean;
  remarks: string;
}

export interface ComponentInfo {
  category: string;
  partNumber: string;
  productName: string;
  quantity: string;
}

export interface AppState {
  step: 'home' | 'requirements' | 'configuration' | 'report';
  customerName: string;
  projectName: string;
  rawRequirements: string;
  rawConfig: string;
  configFileName?: string;
  requirementResult: RequirementAnalysisResult | null;
  comparisonRows: Array<ComparisonRow>;
  extractedComponents: ComponentInfo[];
  requirementReviewer: string;
  configAuthor: string;
  configReviewer: string;
  requirementCheckMap: Record<string, boolean>; // map categoryKey -> boolean
  groupNotes?: Record<string, string>; // Supplementary notes per groupName
  isAnalyzing: boolean;
  error: string | null;
}
