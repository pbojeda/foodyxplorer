// TDD tests for the activated PhotoButton (F092).
// Replaces the placeholder tests in PhotoButton.test.tsx.
// Tests: file input trigger, onFileSelect callback, value reset,
// isLoading disables button, aria-label, no title, accept/capture attributes.

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PhotoButton } from '../../components/PhotoButton';

describe('PhotoButton (active — F092)', () => {
  // ---------------------------------------------------------------------------
  // aria-label and accessibility
  // ---------------------------------------------------------------------------

  it('has aria-label "Subir foto del plato"', () => {
    render(<PhotoButton onFileSelect={jest.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Subir foto del plato');
  });

  it('does NOT have a title attribute', () => {
    render(<PhotoButton onFileSelect={jest.fn()} />);
    expect(screen.getByRole('button')).not.toHaveAttribute('title');
  });

  it('has type="button" to prevent accidental form submission', () => {
    render(<PhotoButton onFileSelect={jest.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  // ---------------------------------------------------------------------------
  // Enabled state (default — isLoading=false)
  // ---------------------------------------------------------------------------

  it('is NOT disabled when isLoading is false (default)', () => {
    render(<PhotoButton onFileSelect={jest.fn()} />);
    expect(screen.getByRole('button')).not.toBeDisabled();
  });

  it('does NOT have cursor-not-allowed class when enabled', () => {
    render(<PhotoButton onFileSelect={jest.fn()} />);
    expect(screen.getByRole('button').className).not.toContain('cursor-not-allowed');
  });

  // ---------------------------------------------------------------------------
  // Disabled state (isLoading=true)
  // ---------------------------------------------------------------------------

  it('is disabled when isLoading=true', () => {
    render(<PhotoButton onFileSelect={jest.fn()} isLoading={true} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  // ---------------------------------------------------------------------------
  // Hidden file input attributes
  // ---------------------------------------------------------------------------

  it('renders a hidden file input with correct accept attribute', () => {
    render(<PhotoButton onFileSelect={jest.fn()} />);
    const input = document.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
  });

  it('renders a hidden file input with capture="environment"', () => {
    render(<PhotoButton onFileSelect={jest.fn()} />);
    const input = document.querySelector('input[type="file"]');
    expect(input).toHaveAttribute('capture', 'environment');
  });

  // ---------------------------------------------------------------------------
  // Click triggers hidden file input
  // ---------------------------------------------------------------------------

  it('triggers click on hidden file input when button is clicked', async () => {
    const user = userEvent.setup();
    render(<PhotoButton onFileSelect={jest.fn()} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = jest.spyOn(input, 'click').mockImplementation(() => {});

    await user.click(screen.getByRole('button'));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // onFileSelect callback
  // ---------------------------------------------------------------------------

  it('calls onFileSelect with the selected File when input changes', async () => {
    const onFileSelect = jest.fn();
    render(<PhotoButton onFileSelect={onFileSelect} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array(100)], 'photo.jpg', { type: 'image/jpeg' });

    await userEvent.upload(input, file);

    expect(onFileSelect).toHaveBeenCalledWith(file);
  });

  it('resets input.value to empty string after file selection (allows same-file re-selection)', async () => {
    const onFileSelect = jest.fn();
    render(<PhotoButton onFileSelect={onFileSelect} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array(100)], 'photo.jpg', { type: 'image/jpeg' });

    await userEvent.upload(input, file);

    // After selection, value should be reset so same file can be selected again
    expect(input.value).toBe('');
  });

  it('does not call onFileSelect when no files are selected (picker cancelled)', async () => {
    const onFileSelect = jest.fn();
    render(<PhotoButton onFileSelect={onFileSelect} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    // Simulate change event with no files (picker cancelled)
    const changeEvent = new Event('change', { bubbles: true });
    Object.defineProperty(changeEvent, 'target', { value: { files: null } });
    input.dispatchEvent(changeEvent);

    expect(onFileSelect).not.toHaveBeenCalled();
  });
});
