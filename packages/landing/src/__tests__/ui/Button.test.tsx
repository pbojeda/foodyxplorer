import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '@/components/ui/Button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('applies primary variant classes by default', () => {
    render(<Button variant="primary">Primary</Button>);
    const button = screen.getByRole('button', { name: 'Primary' });
    expect(button).toHaveClass('bg-brand-orange');
    expect(button).toHaveClass('text-white');
  });

  it('applies secondary variant classes', () => {
    render(<Button variant="secondary">Secondary</Button>);
    const button = screen.getByRole('button', { name: 'Secondary' });
    expect(button).toHaveClass('border');
    expect(button).toHaveClass('border-slate-300');
    expect(button).toHaveClass('bg-transparent');
  });

  it('applies ghost variant classes', () => {
    render(<Button variant="ghost">Ghost</Button>);
    const button = screen.getByRole('button', { name: 'Ghost' });
    expect(button).toHaveClass('bg-transparent');
    expect(button).toHaveClass('text-slate-600');
  });

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    const handleClick = jest.fn();
    render(<Button onClick={handleClick}>Click</Button>);
    await user.click(screen.getByRole('button', { name: 'Click' }));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('shows spinner and disables button when isLoading is true', () => {
    render(<Button isLoading>Submit</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    // Spinner SVG should be present
    expect(button.querySelector('svg')).toBeInTheDocument();
  });

  it('does not call onClick when loading', async () => {
    const user = userEvent.setup();
    const handleClick = jest.fn();
    render(
      <Button isLoading onClick={handleClick}>
        Submit
      </Button>
    );
    await user.click(screen.getByRole('button'));
    expect(handleClick).not.toHaveBeenCalled();
  });

  it('applies sm size classes', () => {
    render(<Button size="sm">Small</Button>);
    const button = screen.getByRole('button', { name: 'Small' });
    expect(button).toHaveClass('text-sm');
    expect(button).toHaveClass('px-4');
  });

  it('applies md size classes by default', () => {
    render(<Button size="md">Medium</Button>);
    const button = screen.getByRole('button', { name: 'Medium' });
    expect(button).toHaveClass('px-8');
  });

  it('applies lg size classes', () => {
    render(<Button size="lg">Large</Button>);
    const button = screen.getByRole('button', { name: 'Large' });
    expect(button).toHaveClass('px-10');
  });

  it('forwards additional props', () => {
    render(<Button type="submit" data-testid="submit-btn">Submit</Button>);
    expect(screen.getByTestId('submit-btn')).toHaveAttribute('type', 'submit');
  });
});
