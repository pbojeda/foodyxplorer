import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubmitButton } from '../../components/SubmitButton';

describe('SubmitButton', () => {
  it('renders with aria-label "Buscar"', () => {
    render(<SubmitButton onSubmit={() => {}} isLoading={false} />);
    expect(screen.getByRole('button', { name: 'Buscar' })).toBeInTheDocument();
  });

  it('calls onSubmit when clicked', async () => {
    const onSubmit = jest.fn();
    render(<SubmitButton onSubmit={onSubmit} isLoading={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('is disabled when isLoading is true', () => {
    render(<SubmitButton onSubmit={() => {}} isLoading={true} />);
    expect(screen.getByRole('button', { name: 'Buscar' })).toBeDisabled();
  });

  it('is not disabled when isLoading is false', () => {
    render(<SubmitButton onSubmit={() => {}} isLoading={false} />);
    expect(screen.getByRole('button', { name: 'Buscar' })).not.toBeDisabled();
  });
});
