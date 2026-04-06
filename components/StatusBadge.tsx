import React from 'react';
import { ValidationStatus } from '../types';
import { CheckCircle2, XCircle, AlertTriangle, HelpCircle } from 'lucide-react';

interface Props {
  status: ValidationStatus;
}

export const StatusBadge: React.FC<Props> = ({ status }) => {
  switch (status) {
    case ValidationStatus.OK:
      return (
        <span className="inline-flex items-center gap-1 text-green-700 font-bold bg-green-100 px-2 py-1 rounded">
          <CheckCircle2 size={16} /> ⭕️ OK
        </span>
      );
    case ValidationStatus.NG:
      return (
        <span className="inline-flex items-center gap-1 text-red-700 font-bold bg-red-100 px-2 py-1 rounded">
          <XCircle size={16} /> ❌ NG
        </span>
      );
    case ValidationStatus.WARN:
      return (
        <span className="inline-flex items-center gap-1 text-amber-700 font-bold bg-amber-100 px-2 py-1 rounded">
          <AlertTriangle size={16} /> 🔺 注意
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 text-gray-600 font-bold bg-gray-100 px-2 py-1 rounded">
          <HelpCircle size={16} /> 不明
        </span>
      );
  }
};