'use client'

import { clsx } from 'clsx'
import { useId } from 'react'
import type { InputHTMLAttributes } from 'react'

interface GlassInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  icon?: React.ReactNode
}

export function GlassInput({ label, error, icon, className, id, ...props }: GlassInputProps) {
  const autoId = useId()
  const inputId = id || `glass-input-${autoId}`
  const errorId = `${inputId}-error`

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-gray-300 mb-2">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true">
            {icon}
          </div>
        )}
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          aria-label={!label ? (props['aria-label'] || props.placeholder) : undefined}
          className={clsx(
            'glass-input w-full',
            icon && 'pl-10',
            error && 'border-red-400 focus:border-red-400 focus:shadow-red-400/20',
            className
          )}
          {...props}
        />
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-sm text-red-400">{error}</p>
      )}
    </div>
  )
}
