import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, parseConfig } from '@/lib/config';
import { GET } from '@/app/api/config/route';
import { ConfiguredForm } from './configured-form';

function freshConfig() {
  return structuredClone(DEFAULT_CONFIG);
}

describe('parseConfig', () => {
  it('accepts defaults and returns an independent copy', () => {
    const result = parseConfig(DEFAULT_CONFIG);
    expect(result).toEqual(DEFAULT_CONFIG);
    result.categories.push('New category');
    expect(DEFAULT_CONFIG.categories).not.toContain('New category');
  });

  it.each([null, [], {}, 'config', { ...DEFAULT_CONFIG, transactions: [] }])('rejects malformed roots: %j', (input) => {
    expect(() => parseConfig(input)).toThrow('Invalid public configuration');
  });

  it.each([[], [''], ['   '], ['Food', ' food '], Array(51).fill('Category'), ['a'.repeat(81)]])('rejects invalid categories: %j', (categories) => {
    expect(() => parseConfig({ ...DEFAULT_CONFIG, categories })).toThrow();
  });

  it.each([0, -1, 2001, 1.5, '500', NaN, Infinity])('rejects invalid text limits: %j', (maxLength) => {
    const config = freshConfig();
    Object.assign(config.form.fields[1], { maxLength });
    expect(() => parseConfig(config)).toThrow();
  });

  it.each([
    { type: 'checkbox' }, { name: 'reviewed' }, { html: '<b>Note</b>' },
    { url: 'https://example.com' }, { onChange: 'eval()' }, { label: '' },
  ])('rejects unsupported field properties: %j', (properties) => {
    const config = freshConfig();
    Object.assign(config.form.fields[1], properties);
    expect(() => parseConfig(config)).toThrow();
  });

  it('rejects missing, duplicate, extra, and mismatched fields', () => {
    const config = freshConfig();
    for (const fields of [[], [config.form.fields[0]], Array(2).fill(config.form.fields[0]), [...config.form.fields, config.form.fields[1]]]) {
      expect(() => parseConfig({ ...config, form: { fields } })).toThrow();
    }
    Object.assign(config.form.fields[0], { options: ['Unknown'] });
    expect(() => parseConfig(config)).toThrow();
  });

  it('accepts boundary limits and reordered fields', () => {
    for (const maxLength of [1, 2000]) {
      const config = freshConfig();
      Object.assign(config.form.fields[1], { maxLength });
      config.form.fields.reverse();
      expect(parseConfig(config)).toEqual(config);
    }
  });

  it('rejects sparse arrays and extra form properties', () => {
    expect(() => parseConfig({ ...DEFAULT_CONFIG, categories: Array(2) })).toThrow();
    const fields = Array(2);
    fields[1] = DEFAULT_CONFIG.form.fields[1];
    expect(() => parseConfig({ ...DEFAULT_CONFIG, form: { fields } })).toThrow();
    expect(() => parseConfig({ ...DEFAULT_CONFIG, form: { ...DEFAULT_CONFIG.form, action: '/upload' } })).toThrow();
  });
});

describe('public configuration API', () => {
  it('returns only validated public configuration with cache headers', async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('public');
    const body: unknown = await response.json();
    expect(parseConfig(body)).toEqual(DEFAULT_CONFIG);
    expect(Object.keys(body as object).sort()).toEqual(['categories', 'form']);
  });
});

describe('ConfiguredForm', () => {
  it('supports keyboard editing through controlled parent state', async () => {
    const user = userEvent.setup();
    function Parent() {
      const [values, setValues] = useState({ category: DEFAULT_CONFIG.categories[0], note: '' });
      return <ConfiguredForm config={DEFAULT_CONFIG.form} values={values} onChange={(field, value) => setValues((previous) => ({ ...previous, [field]: value }))} />;
    }
    render(<Parent />);
    await user.tab();
    expect(screen.getByLabelText('Category')).toHaveFocus();
    await user.selectOptions(screen.getByLabelText('Category'), DEFAULT_CONFIG.categories[1]);
    expect(screen.getByLabelText('Category')).toHaveValue(DEFAULT_CONFIG.categories[1]);
    await user.tab();
    await user.keyboard('Lunch');
    expect(screen.getByLabelText('Note')).toHaveValue('Lunch');
    expect(screen.getByText('5/500 characters')).toBeInTheDocument();
  });

  it('enforces configured text limits before calling the parent', async () => {
    const config = freshConfig();
    Object.assign(config.form.fields[1], { maxLength: 3 });
    const changed = vi.fn();
    function Parent() {
      const [values, setValues] = useState({ category: config.categories[0], note: '' });
      return <ConfiguredForm config={config.form} values={values} onChange={(field, value) => {
        changed(field, value);
        setValues((previous) => ({ ...previous, [field]: value }));
      }} />;
    }
    render(<Parent />);
    await userEvent.type(screen.getByLabelText('Note'), 'abcd');
    expect(screen.getByLabelText('Note')).toHaveValue('abc');
    expect(changed).toHaveBeenLastCalledWith('note', 'abc');
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'too long' } });
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it('shows accessible validation for invalid supplied values', () => {
    render(<ConfiguredForm config={DEFAULT_CONFIG.form} values={{ category: 'Unknown', note: 'a'.repeat(501) }} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Category')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Note')).toHaveAccessibleDescription('Use at most 500 characters.');
    expect(screen.getAllByRole('alert')).toHaveLength(2);
  });

  it('renders labels as text and keeps instance IDs unique', () => {
    const config = freshConfig();
    config.form.fields[1].label = '<img src=x onerror=alert(1)>';
    const { container } = render(<>
      <ConfiguredForm config={config.form} values={{}} onChange={vi.fn()} />
      <ConfiguredForm config={config.form} values={{}} onChange={vi.fn()} />
    </>);
    expect(screen.getAllByLabelText('<img src=x onerror=alert(1)>')).toHaveLength(2);
    expect(container.querySelector('img')).toBeNull();
    const controls = Array.from(container.querySelectorAll('input, select'));
    expect(new Set(controls.map((control) => control.id)).size).toBe(4);
  });
});
