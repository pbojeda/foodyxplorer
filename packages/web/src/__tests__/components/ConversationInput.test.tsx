import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationInput } from '../../components/ConversationInput';

function renderInput(props: Partial<React.ComponentProps<typeof ConversationInput>> = {}) {
  const defaults = {
    value: '',
    onChange: jest.fn(),
    onSubmit: jest.fn(),
    onPhotoSelect: jest.fn(),
    isLoading: false,
    isPhotoLoading: false,
    inlineError: null,
  };
  return render(<ConversationInput {...defaults} {...props} />);
}

describe('ConversationInput', () => {
  describe('Enter key submission', () => {
    it('calls onSubmit when Enter is pressed and value is non-empty', async () => {
      const onSubmit = jest.fn();
      renderInput({ value: 'big mac', onSubmit });

      const textarea = screen.getByRole('textbox');
      await userEvent.type(textarea, '{Enter}');

      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('does NOT call onSubmit when Enter is pressed and value is empty', async () => {
      const onSubmit = jest.fn();
      renderInput({ value: '', onSubmit });

      const textarea = screen.getByRole('textbox');
      await userEvent.type(textarea, '{Enter}');

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('does NOT call onSubmit when Enter is pressed and value is whitespace only', async () => {
      const onSubmit = jest.fn();
      renderInput({ value: '   ', onSubmit });

      const textarea = screen.getByRole('textbox');
      await userEvent.type(textarea, '{Enter}');

      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe('Shift+Enter newline', () => {
    it('does NOT call onSubmit when Shift+Enter is pressed', async () => {
      const onSubmit = jest.fn();
      renderInput({ value: 'big mac', onSubmit });

      const textarea = screen.getByRole('textbox');
      await userEvent.type(textarea, '{Shift>}{Enter}{/Shift}');

      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe('disabled state', () => {
    it('textarea is disabled when isLoading is true', () => {
      renderInput({ isLoading: true });
      expect(screen.getByRole('textbox')).toBeDisabled();
    });

    it('textarea is not disabled when isLoading is false', () => {
      renderInput({ isLoading: false });
      expect(screen.getByRole('textbox')).not.toBeDisabled();
    });

    it('textarea is disabled when isPhotoLoading is true', () => {
      renderInput({ isPhotoLoading: true });
      expect(screen.getByRole('textbox')).toBeDisabled();
    });

    it('PhotoButton is disabled when isPhotoLoading is true', () => {
      renderInput({ isPhotoLoading: true });
      expect(screen.getByRole('button', { name: 'Subir foto del plato' })).toBeDisabled();
    });
  });

  describe('SubmitButton visibility', () => {
    it('does NOT render SubmitButton when value is empty', () => {
      renderInput({ value: '' });
      expect(screen.queryByRole('button', { name: 'Buscar' })).not.toBeInTheDocument();
    });

    it('does NOT render SubmitButton when value is whitespace only', () => {
      renderInput({ value: '   ' });
      expect(screen.queryByRole('button', { name: 'Buscar' })).not.toBeInTheDocument();
    });

    it('renders SubmitButton when value is non-empty', () => {
      renderInput({ value: 'big mac' });
      expect(screen.getByRole('button', { name: 'Buscar' })).toBeInTheDocument();
    });
  });

  describe('inline error', () => {
    it('renders inlineError message when prop is non-null', () => {
      renderInput({ inlineError: 'Demasiado largo. Máx. 500 caracteres.' });
      expect(screen.getByText('Demasiado largo. Máx. 500 caracteres.')).toBeInTheDocument();
    });

    it('does NOT render error when inlineError is null', () => {
      renderInput({ inlineError: null });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('placeholder buttons', () => {
    it('renders MicButton (disabled placeholder)', () => {
      renderInput();
      expect(screen.getByRole('button', { name: 'Micrófono (próximamente)' })).toBeInTheDocument();
    });

    it('renders PhotoButton (active, aria-label "Subir foto del plato")', () => {
      renderInput();
      expect(screen.getByRole('button', { name: 'Subir foto del plato' })).toBeInTheDocument();
    });
  });
});
