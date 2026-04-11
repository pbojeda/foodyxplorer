'use client';

// PhotoButton — interactive camera button for F092 Photo Upload.
// Owns the hidden <input type="file"> and triggers it programmatically on click.

import { useRef } from 'react';

interface PhotoButtonProps {
  onFileSelect: (file: File) => void;
  isLoading?: boolean;
}

export function PhotoButton({ onFileSelect, isLoading = false }: PhotoButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleButtonClick() {
    inputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    onFileSelect(file);

    // Reset value so that selecting the same file again fires onChange
    e.target.value = '';
  }

  return (
    <>
      <button
        type="button"
        onClick={handleButtonClick}
        disabled={isLoading}
        aria-label="Subir foto del plato"
        className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-brand-green bg-white text-brand-green hover:bg-emerald-50 active:scale-[0.97] transition-all duration-200 disabled:opacity-40 disabled:pointer-events-none disabled:border-slate-200 disabled:text-slate-400"
      >
        {/* Camera SVG */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-[22px] w-[22px]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z"
          />
        </svg>
      </button>

      {/* Hidden file input — owned here so PhotoButton is self-contained */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        onChange={handleFileChange}
        hidden
        aria-hidden="true"
      />
    </>
  );
}
