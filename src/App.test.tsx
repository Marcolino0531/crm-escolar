import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';

test('renders Schooler Hub header', () => {
  render(<App />);
  const headerElement = screen.getByText(/Schooler Hub/i);
  expect(headerElement).toBeInTheDocument();
});
