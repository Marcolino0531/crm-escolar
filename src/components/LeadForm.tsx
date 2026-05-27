import React, { useState } from 'react';
import { Lead } from '../types';

interface LeadFormProps {
  onSubmit: (dados: Omit<Lead, 'id' | 'coluna' | 'criadoEm'>) => void;
  onFechar: () => void;
}

const LeadForm: React.FC<LeadFormProps> = ({ onSubmit, onFechar }) => {
  const [form, setForm] = useState({
    nomeAluno: '',
    idade: '',
    dataNascimento: '',
    nomePaiMae: '',
    telefone: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nomeAluno.trim() || !form.nomePaiMae.trim() || !form.telefone.trim()) {
      return;
    }
    onSubmit(form);
    setForm({
      nomeAluno: '',
      idade: '',
      dataNascimento: '',
      nomePaiMae: '',
      telefone: '',
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl">📝</span>
              <h2 className="text-white text-lg font-bold">Novo Lead</h2>
            </div>
            <button
              onClick={onFechar}
              className="text-white/80 hover:text-white transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nome do Aluno <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="nomeAluno"
              value={form.nomeAluno}
              onChange={handleChange}
              required
              placeholder="Ex: João da Silva"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Idade
              </label>
              <input
                type="number"
                name="idade"
                value={form.idade}
                onChange={handleChange}
                min="0"
                max="25"
                placeholder="Ex: 10"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Data de Nascimento
              </label>
              <input
                type="date"
                name="dataNascimento"
                value={form.dataNascimento}
                onChange={handleChange}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nome do Pai/Mãe <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="nomePaiMae"
              value={form.nomePaiMae}
              onChange={handleChange}
              required
              placeholder="Ex: Maria da Silva"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Telefone <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              name="telefone"
              value={form.telefone}
              onChange={handleChange}
              required
              placeholder="Ex: (11) 99999-9999"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors text-sm"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onFechar}
              className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:from-indigo-700 hover:to-purple-700 transition-colors text-sm font-medium shadow-md"
            >
              Cadastrar Lead
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LeadForm;
