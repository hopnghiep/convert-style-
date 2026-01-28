
import React, { useState } from 'react';
import type { ArtStyle } from '../types';

interface DeletedStylesProps {
  deletedStyles: ArtStyle[];
  onRestore: (styleId: string) => void;
  onRestoreAll: () => void;
  onPermanentlyDelete: (styleId: string) => void;
}

const DeletedStyles: React.FC<DeletedStylesProps> = ({ deletedStyles, onRestore, onRestoreAll, onPermanentlyDelete }) => {
  const [isExpanded, setIsExpanded] = useState(true);

  if (deletedStyles.length === 0) {
    return null;
  }

  const handlePermanentDelete = (e: React.MouseEvent, styleId: string, styleLabel: string) => {
    e.stopPropagation();
    if (window.confirm(`Are you sure you want to permanently delete the "${styleLabel}" style? This action cannot be undone.`)) {
      onPermanentlyDelete(styleId);
    }
  };

  return (
    <div className="mt-4 border-t border-gray-300 pt-4 animate-fade-in">
      <div
        className="flex justify-between items-center cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <h3 className="text-md font-normal text-gray-700">Recently Deleted ({deletedStyles.length})</h3>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-5 w-5 text-gray-500 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {isExpanded && (
        <div className="mt-2 space-y-2 animate-fade-in">
          <button
            onClick={onRestoreAll}
            className="w-full text-center px-3 py-1.5 text-xs font-normal rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors"
          >
            Restore All
          </button>
          <ul className="space-y-1 max-h-32 overflow-y-auto pr-2">
            {deletedStyles.map((style) => (
              <li
                key={style.id}
                className="flex justify-between items-center bg-gray-100/80 p-2 rounded-lg text-sm"
              >
                <span className="text-gray-800 truncate pr-2">{style.label}</span>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => onRestore(style.id)}
                    className="px-3 py-1 text-xs font-normal rounded-md bg-[#4A6B5D] text-white hover:bg-[#3e5a4e] transition-colors"
                    aria-label={`Restore ${style.label} style`}
                  >
                    Restore
                  </button>
                  <button
                    onClick={(e) => handlePermanentDelete(e, style.id, style.label)}
                    className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-100 rounded-full transition-colors"
                    aria-label={`Permanently delete ${style.label} style`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default DeletedStyles;
