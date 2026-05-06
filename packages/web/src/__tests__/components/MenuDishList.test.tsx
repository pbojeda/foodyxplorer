// TDD tests for MenuDishItem and MenuDishList (F-WEB-MENU-VISION-001).
// Dish list component for multi-dish menu photo analysis results.

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MenuDishItem } from '../../components/MenuDishItem';
import { MenuDishList } from '../../components/MenuDishList';
import {
  createMenuAnalysisDish,
  createEstimateData,
  createEstimateResult,
} from '../fixtures';

// ---------------------------------------------------------------------------
// MenuDishItem tests
// ---------------------------------------------------------------------------

describe('MenuDishItem', () => {
  it('displays dish name and kcal when estimate is available', () => {
    const dish = createMenuAnalysisDish({
      dishName: 'Paella valenciana',
      estimate: createEstimateData({
        query: 'paella valenciana',
        result: createEstimateResult({ name: 'Paella valenciana', nutrients: {
          calories: 640,
          proteins: 20,
          carbohydrates: 80,
          sugars: 5,
          fats: 10,
          saturatedFats: 2,
          fiber: 3,
          salt: 1.5,
          sodium: 0.6,
          transFats: 0,
          cholesterol: 0,
          potassium: 0,
          monounsaturatedFats: 0,
          polyunsaturatedFats: 0,
          alcohol: 0,
          referenceBasis: 'per_portion',
        }}),
      }),
    });

    render(<MenuDishItem dish={dish} onSelect={jest.fn()} />);

    expect(screen.getByText('Paella valenciana')).toBeInTheDocument();
    expect(screen.getByText('640 kcal')).toBeInTheDocument();
  });

  it('displays "Sin datos" when estimate is null', () => {
    const dish = createMenuAnalysisDish({
      dishName: 'Fideuà',
      estimate: null,
    });

    render(<MenuDishItem dish={dish} onSelect={jest.fn()} />);

    expect(screen.getByText('Fideuà')).toBeInTheDocument();
    expect(screen.getByText('Sin datos')).toBeInTheDocument();
  });

  it('calls onSelect when clicked', async () => {
    const onSelect = jest.fn();
    const dish = createMenuAnalysisDish({ dishName: 'Gazpacho', estimate: null });

    render(<MenuDishItem dish={dish} onSelect={onSelect} />);

    await userEvent.click(screen.getByRole('button'));

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('calls onSelect when Enter key is pressed', async () => {
    const onSelect = jest.fn();
    const dish = createMenuAnalysisDish({ dishName: 'Gazpacho', estimate: null });

    render(<MenuDishItem dish={dish} onSelect={onSelect} />);

    screen.getByRole('button').focus();
    await userEvent.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// MenuDishList tests
// ---------------------------------------------------------------------------

describe('MenuDishList', () => {
  function makeDishes(count: number) {
    return Array.from({ length: count }, (_, i) =>
      createMenuAnalysisDish({ dishName: `Plato ${i + 1}`, estimate: null })
    );
  }

  it('renders header with dish count', () => {
    const dishes = makeDishes(3);

    render(
      <MenuDishList
        dishes={dishes}
        onDishSelect={jest.fn()}
      />
    );

    expect(screen.getByText('Se han encontrado 3 platos')).toBeInTheDocument();
  });

  it('shows partial banner when partial=true', () => {
    const dishes = makeDishes(2);

    render(
      <MenuDishList
        dishes={dishes}
        onDishSelect={jest.fn()}
        partial={true}
      />
    );

    expect(screen.getByRole('note')).toBeInTheDocument();
  });

  it('does NOT show partial banner when partial=false', () => {
    const dishes = makeDishes(2);

    render(
      <MenuDishList
        dishes={dishes}
        onDishSelect={jest.fn()}
        partial={false}
      />
    );

    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('renders a row for each dish', () => {
    const dishes = [
      createMenuAnalysisDish({ dishName: 'Paella', estimate: null }),
      createMenuAnalysisDish({ dishName: 'Gazpacho', estimate: null }),
      createMenuAnalysisDish({ dishName: 'Tortilla', estimate: null }),
      createMenuAnalysisDish({ dishName: 'Croquetas', estimate: null }),
    ];

    render(
      <MenuDishList
        dishes={dishes}
        onDishSelect={jest.fn()}
      />
    );

    expect(screen.getByText('Paella')).toBeInTheDocument();
    expect(screen.getByText('Gazpacho')).toBeInTheDocument();
    expect(screen.getByText('Tortilla')).toBeInTheDocument();
    expect(screen.getByText('Croquetas')).toBeInTheDocument();
  });

  it('calls onDishSelect with dishName when a dish row is clicked', async () => {
    const onDishSelect = jest.fn();
    const dishes = [
      createMenuAnalysisDish({ dishName: 'Paella valenciana', estimate: null }),
      createMenuAnalysisDish({ dishName: 'Fideuà', estimate: null }),
    ];

    render(
      <MenuDishList
        dishes={dishes}
        onDishSelect={onDishSelect}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /Paella valenciana/i }));

    expect(onDishSelect).toHaveBeenCalledWith('Paella valenciana');
  });

  it('applies max-h-[420px] overflow-y-auto when dishes.length > 6', () => {
    const dishes = makeDishes(7);

    render(
      <MenuDishList
        dishes={dishes}
        onDishSelect={jest.fn()}
      />
    );

    // The scrollable list wrapper should have the max-h class
    const listWrapper = screen.getByRole('list');
    expect(listWrapper.className).toContain('max-h-[420px]');
    expect(listWrapper.className).toContain('overflow-y-auto');
  });
});
