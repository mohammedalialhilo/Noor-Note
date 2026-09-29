// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newBaseView } from '@noor-note/core';
import { BaseAggregateSettings, BaseFormulaSettings } from '../src/components/BaseFormulaSettings';

afterEach(cleanup);

describe('Base formula settings', () => {
  it('validates source and saves an expression without touching notes', async () => {
    const onSave = vi.fn(async () => true);
    render(<BaseFormulaSettings formulas={[]} onSave={onSave} onDelete={vi.fn(async () => true)} />);
    fireEvent.change(screen.getByLabelText('Formula name'), { target: { value: 'Total' } });
    fireEvent.change(screen.getByLabelText('Expression'), { target: { value: 'price.constructor()' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add formula' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Expression'), { target: { value: 'price * quantity' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add formula' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'Total', expression: 'price * quantity' })));
  });

  it('adds a persisted numeric summary to the current Base view', () => {
    const view = newBaseView('table');
    const onPatch = vi.fn(async () => undefined);
    render(<BaseAggregateSettings view={view} fields={['property:price']} formulaLabels={{}} onPatch={onPatch} />);
    fireEvent.change(screen.getByLabelText('Aggregate operation'), { target: { value: 'sum' } });
    fireEvent.change(screen.getByLabelText('Aggregate field'), { target: { value: 'property:price' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add summary' }));
    expect(onPatch).toHaveBeenCalledWith({ aggregates: [expect.objectContaining({ operation: 'sum', field: 'property:price', label: 'sum price' })] });
  });
});
