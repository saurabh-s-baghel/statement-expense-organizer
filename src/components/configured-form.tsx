'use client';

import { useId } from 'react';
import type { FormConfig } from '@/lib/config';

export type ConfiguredFormProps = {
  config: FormConfig;
  values: Record<string, string>;
  onChange: (field: string, value: string) => void;
};

export function ConfiguredForm({ config, values, onChange }: ConfiguredFormProps) {
  const formId = useId();

  return (
    <div className="configured-form">
      {config.fields.map((field) => {
        const inputId = `${formId}-${field.name}`;
        const messageId = `${inputId}-message`;
        const value = values[field.name] ?? '';
        const error = field.type === 'select'
          ? (field.options.includes(value) ? '' : 'Choose a listed category.')
          : (value.length > field.maxLength ? `Use at most ${field.maxLength} characters.` : '');

        return (
          <div key={field.name}>
            <label htmlFor={inputId}>{field.label}</label>
            {field.type === 'select' ? (
              <select
                id={inputId}
                name={field.name}
                value={field.options.includes(value) ? value : ''}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? messageId : undefined}
                onChange={(event) => {
                  if (field.options.includes(event.target.value)) onChange(field.name, event.target.value);
                }}
              >
                <option value="" disabled>Choose a category</option>
                {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            ) : (
              <input
                id={inputId}
                name={field.name}
                type="text"
                value={value}
                maxLength={field.maxLength}
                aria-invalid={Boolean(error)}
                aria-describedby={messageId}
                onChange={(event) => {
                  if (event.target.value.length <= field.maxLength) onChange(field.name, event.target.value);
                }}
              />
            )}
            {error ? (
              <p id={messageId} role="alert">{error}</p>
            ) : field.type === 'text' ? (
              <p id={messageId}>{value.length}/{field.maxLength} characters</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
