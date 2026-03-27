import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from '@/components/ui/Input';

describe('Input', () => {
  it('renders with a label', () => {
    render(<Input id="email" label="Email address" />);
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByText('Email address')).toBeInTheDocument();
  });

  it('renders the input element', () => {
    render(<Input id="email" label="Email" />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('associates label with input via htmlFor', () => {
    render(<Input id="email-input" label="Email" />);
    const label = screen.getByText('Email');
    expect(label).toHaveAttribute('for', 'email-input');
  });

  it('shows error message with role="alert"', () => {
    render(<Input id="email" label="Email" error="Introduce un email válido" />);
    const errorMessage = screen.getByRole('alert');
    expect(errorMessage).toBeInTheDocument();
    expect(errorMessage).toHaveTextContent('Introduce un email válido');
  });

  it('does not show error message when error is not provided', () => {
    render(<Input id="email" label="Email" />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('applies error styles when error is present', () => {
    render(<Input id="email" label="Email" error="Error message" />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveClass('border-red-500');
  });

  it('applies default border styles without error', () => {
    render(<Input id="email" label="Email" />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveClass('border-slate-300');
  });

  it('propagates controlled value changes', async () => {
    const user = userEvent.setup();
    let value = '';
    const handleChange = jest.fn((e: React.ChangeEvent<HTMLInputElement>) => {
      value = e.target.value;
    });
    render(
      <Input
        id="email"
        label="Email"
        value={value}
        onChange={handleChange}
      />
    );
    const input = screen.getByRole('textbox');
    await user.type(input, 'test@example.com');
    expect(handleChange).toHaveBeenCalled();
  });

  it('forwards additional input props', () => {
    render(
      <Input
        id="email"
        label="Email"
        type="email"
        placeholder="tu@email.com"
        data-testid="email-input"
      />
    );
    const input = screen.getByTestId('email-input');
    expect(input).toHaveAttribute('type', 'email');
    expect(input).toHaveAttribute('placeholder', 'tu@email.com');
  });
});
