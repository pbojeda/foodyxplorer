import React from 'react';
import { render, screen } from '@testing-library/react';
import { RestaurantsSection } from '@/components/sections/RestaurantsSection';
import { getDictionary } from '@/lib/i18n';

const dict = getDictionary('es');

describe('RestaurantsSection', () => {
  it('renders the section heading', () => {
    render(<RestaurantsSection dict={dict.restaurants} />);
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });

  it('renders the eyebrow', () => {
    render(<RestaurantsSection dict={dict.restaurants} />);
    expect(screen.getByText(dict.restaurants.eyebrow)).toBeInTheDocument();
  });

  it('renders the subtitle', () => {
    render(<RestaurantsSection dict={dict.restaurants} />);
    expect(screen.getByText(dict.restaurants.subtitle)).toBeInTheDocument();
  });

  it('renders all 3 restaurant type items', () => {
    render(<RestaurantsSection dict={dict.restaurants} />);
    for (const item of dict.restaurants.items) {
      expect(screen.getByText(item.label)).toBeInTheDocument();
      expect(screen.getByText(item.note)).toBeInTheDocument();
    }
  });

  it('renders as a section landmark', () => {
    render(<RestaurantsSection dict={dict.restaurants} />);
    expect(screen.getByRole('region')).toBeInTheDocument();
  });
});
