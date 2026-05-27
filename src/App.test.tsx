import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';

test('renders CRM Escolar header', () => {
  render(<App />);
  const headerElement = screen.getByText(/CRM Escolar/i);
  expect(headerElement).toBeInTheDocument();
});
