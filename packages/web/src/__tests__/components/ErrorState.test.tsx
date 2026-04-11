import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorState } from '../../components/ErrorState';

describe('ErrorState', () => {
  it('renders the provided error message', () => {
    render(<ErrorState message="Sin conexión. Comprueba tu red." onRetry={() => {}} />);
    expect(screen.getByText('Sin conexión. Comprueba tu red.')).toBeInTheDocument();
  });

  it('renders the retry button', () => {
    render(<ErrorState message="Error" onRetry={() => {}} />);
    expect(screen.getByRole('button', { name: /Intentar de nuevo/i })).toBeInTheDocument();
  });

  it('calls onRetry when retry button is clicked', async () => {
    const onRetry = jest.fn();
    render(<ErrorState message="Error" onRetry={onRetry} />);

    await userEvent.click(screen.getByRole('button', { name: /Intentar de nuevo/i }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders a warning icon', () => {
    const { container } = render(<ErrorState message="Error" onRetry={() => {}} />);
    // Warning icon is an SVG or emoji
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });
});
