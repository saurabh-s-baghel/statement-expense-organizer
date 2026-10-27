export type SelectField = {
  name: 'category';
  type: 'select';
  label: string;
  options: string[];
};

export type TextField = {
  name: 'note';
  type: 'text';
  label: string;
  maxLength: number;
};

export type FormField = SelectField | TextField;
export type FormConfig = { fields: FormField[] };
export type AppConfig = { categories: string[]; form: FormConfig };

const categories = [
  'Uncategorized',
  'Food & Dining',
  'Groceries',
  'Transport',
  'Shopping',
  'Housing',
  'Utilities',
  'Health',
  'Entertainment',
  'Income',
  'Transfer',
  'Other',
];

export const DEFAULT_CONFIG: AppConfig = {
  categories,
  form: {
    fields: [
      { name: 'category', type: 'select', label: 'Category', options: [...categories] },
      { name: 'note', type: 'text', label: 'Note', maxLength: 500 },
    ],
  },
};

function invalid(): never {
  throw new Error('Invalid public configuration');
}

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(result, key))) invalid();
  return result;
}

function label(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 80) invalid();
  return value;
}

function options(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) invalid();
  const result = Array.from(value, label);
  if (new Set(result.map((item) => item.trim().toLowerCase())).size !== result.length) invalid();
  return result;
}

export function parseConfig(input: unknown): AppConfig {
  const root = record(input, ['categories', 'form']);
  const parsedCategories = options(root.categories);
  const form = record(root.form, ['fields']);
  if (!Array.isArray(form.fields) || form.fields.length !== 2) invalid();

  const fields: FormField[] = Array.from(form.fields, (inputField: unknown) => {
    if (typeof inputField !== 'object' || inputField === null) invalid();
    if ('type' in inputField && inputField.type === 'select') {
      const field = record(inputField, ['name', 'type', 'label', 'options']);
      if (field.name !== 'category') invalid();
      const fieldOptions = options(field.options);
      if (fieldOptions.length !== parsedCategories.length ||
          fieldOptions.some((option, index) => option !== parsedCategories[index])) invalid();
      return { name: 'category', type: 'select', label: label(field.label), options: fieldOptions };
    }
    const field = record(inputField, ['name', 'type', 'label', 'maxLength']);
    if (field.name !== 'note' || field.type !== 'text' ||
        typeof field.maxLength !== 'number' || !Number.isInteger(field.maxLength) ||
        field.maxLength < 1 || field.maxLength > 2000) invalid();
    return { name: 'note', type: 'text', label: label(field.label), maxLength: field.maxLength };
  });

  if (new Set(fields.map((field) => field.name)).size !== 2) invalid();
  return { categories: parsedCategories, form: { fields } };
}
