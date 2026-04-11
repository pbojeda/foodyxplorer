import React from 'react';
import { render, screen } from '@testing-library/react';
import { ConfidenceBadge } from '../../components/ConfidenceBadge';

describe('ConfidenceBadge', () => {
  it('renders "Verificado" for high confidence', () => {
    render(<ConfidenceBadge level="high" />);
    expect(screen.getByText('Verificado')).toBeInTheDocument();
  });

  it('renders "Estimado" for medium confidence', () => {
    render(<ConfidenceBadge level="medium" />);
    expect(screen.getByText('Estimado')).toBeInTheDocument();
  });

  it('renders "Aproximado" for low confidence', () => {
    render(<ConfidenceBadge level="low" />);
    expect(screen.getByText('Aproximado')).toBeInTheDocument();
  });

  it('applies emerald classes for high confidence', () => {
    const { container } = render(<ConfidenceBadge level="high" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('emerald');
  });

  it('applies amber classes for medium confidence', () => {
    const { container } = render(<ConfidenceBadge level="medium" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('amber');
  });

  it('applies rose classes for low confidence', () => {
    const { container } = render(<ConfidenceBadge level="low" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('rose');
  });
});
