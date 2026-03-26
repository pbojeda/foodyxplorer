import { render, screen } from '@testing-library/react';
import { Badge } from '@/components/ui/Badge';

describe('Badge', () => {
  it('renders children', () => {
    render(<Badge variant="high">ALTA CONFIANZA</Badge>);
    expect(screen.getByText('ALTA CONFIANZA')).toBeInTheDocument();
  });

  it('applies high variant classes (emerald)', () => {
    render(<Badge variant="high">HIGH</Badge>);
    const badge = screen.getByText('HIGH');
    expect(badge).toHaveClass('bg-emerald-100');
    expect(badge).toHaveClass('text-emerald-800');
    expect(badge).toHaveClass('border-emerald-200');
  });

  it('applies medium variant classes (amber)', () => {
    render(<Badge variant="medium">MEDIUM</Badge>);
    const badge = screen.getByText('MEDIUM');
    expect(badge).toHaveClass('bg-amber-100');
    expect(badge).toHaveClass('text-amber-800');
    expect(badge).toHaveClass('border-amber-200');
  });

  it('applies low variant classes (rose)', () => {
    render(<Badge variant="low">LOW</Badge>);
    const badge = screen.getByText('LOW');
    expect(badge).toHaveClass('bg-rose-100');
    expect(badge).toHaveClass('text-rose-800');
    expect(badge).toHaveClass('border-rose-200');
  });

  it('renders as a span element', () => {
    const { container } = render(<Badge variant="high">Test</Badge>);
    expect(container.firstChild?.nodeName).toBe('SPAN');
  });

  it('has rounded-full class for pill shape', () => {
    render(<Badge variant="medium">Test</Badge>);
    const badge = screen.getByText('Test');
    expect(badge).toHaveClass('rounded-full');
  });

  it('accepts additional className', () => {
    render(<Badge variant="high" className="custom-class">Test</Badge>);
    const badge = screen.getByText('Test');
    expect(badge).toHaveClass('custom-class');
  });
});
