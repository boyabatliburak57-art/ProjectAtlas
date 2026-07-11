import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import HomePage from './page';

describe('HomePage', () => {
  it('shows the scaffold status and configured API URL', () => {
    render(<HomePage />);

    expect(
      screen.getByRole('heading', { name: 'Uygulama iskeleti çalışıyor.' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('http://localhost:3001/api/v1'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Yatırım tavsiyesi değildir/)).toBeInTheDocument();
  });
});
