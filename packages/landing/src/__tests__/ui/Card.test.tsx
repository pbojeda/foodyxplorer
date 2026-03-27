import { render, screen } from '@testing-library/react';
import { Card } from '@/components/ui/Card';

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Card content</Card>);
    expect(screen.getByText('Card content')).toBeInTheDocument();
  });

  it('applies default card styles', () => {
    render(<Card data-testid="card">Content</Card>);
    const card = screen.getByTestId('card');
    expect(card).toHaveClass('rounded-2xl');
    expect(card).toHaveClass('bg-white');
    expect(card).toHaveClass('shadow-soft');
    expect(card).toHaveClass('border');
    expect(card).toHaveClass('border-slate-100');
  });

  it('accepts additional className for overrides', () => {
    render(<Card className="custom-class" data-testid="card">Content</Card>);
    const card = screen.getByTestId('card');
    expect(card).toHaveClass('custom-class');
    // Still has base classes
    expect(card).toHaveClass('rounded-2xl');
  });

  it('renders complex children', () => {
    render(
      <Card>
        <h2>Card Title</h2>
        <p>Card body text</p>
      </Card>
    );
    expect(screen.getByText('Card Title')).toBeInTheDocument();
    expect(screen.getByText('Card body text')).toBeInTheDocument();
  });

  it('renders as a div element by default', () => {
    const { container } = render(<Card>Content</Card>);
    expect(container.firstChild?.nodeName).toBe('DIV');
  });
});
