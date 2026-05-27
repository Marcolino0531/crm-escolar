import React, { useState } from 'react';
import { Settings, UserPlus, Trash2, Shield, AlertCircle, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Modulo } from '../types';

const MODULOS_DISPONIVEIS: { id: Modulo; titulo: string }[] = [
  { id: 'admissoes', titulo: 'Admissões' },
  { id: 'onboarding', titulo: 'Onboarding' },
  { id: 'rh', titulo: 'Recursos Humanos' },
];

const ConfiguracoesPage: React.FC = () => {
  const { usuarios, criarUsuario, removerUsuario } = useAuth();
  const [modalAberto, setModalAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [permissoes, setPermissoes] = useState<Modulo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);

  const togglePermissao = (modulo: Modulo) => {
    setPermissoes((prev) =>
      prev.includes(modulo) ? prev.filter((p) => p !== modulo) : [...prev, modulo]
    );
  };

  const handleCriar = (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);

    if (!nome.trim() || !email.trim() || !senha.trim()) {
      setErro('Preencha todos os campos obrigatórios.');
      return;
    }

    if (permissoes.length === 0) {
      setErro('Selecione pelo menos uma permissão.');
      return;
    }

    const resultado = criarUsuario({
      nome: nome.trim(),
      email: email.trim(),
      senha: senha,
      perfil: 'funcionario',
      permissoes,
    });

    if (resultado) {
      setErro(resultado);
      return;
    }

    setNome('');
    setEmail('');
    setSenha('');
    setPermissoes([]);
    setSucesso(true);
    setTimeout(() => {
      setSucesso(false);
      setModalAberto(false);
    }, 1500);
  };

  const handleRemover = (id: string) => {
    if (window.confirm('Tem certeza que deseja remover este usuário?')) {
      removerUsuario(id);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-indigo-100 rounded-lg p-2">
          <Settings size={24} className="text-indigo-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-800">Configurações</h2>
          <p className="text-sm text-gray-500">Gestão de Usuários e Permissões</p>
        </div>
      </div>

      {/* Seção Gestão de Usuários */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Shield size={18} className="text-indigo-600" />
            <h3 className="font-semibold text-gray-800">Gestão de Usuários</h3>
            <span className="bg-indigo-100 text-indigo-700 text-xs font-semibold px-2 py-0.5 rounded-full">
              {usuarios.length}
            </span>
          </div>
          <button
            onClick={() => {
              setModalAberto(true);
              setErro(null);
              setSucesso(false);
            }}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg font-semibold text-sm hover:bg-indigo-700 transition-colors shadow-md"
          >
            <UserPlus size={16} />
            Novo Usuário
          </button>
        </div>

        {/* Lista de usuários */}
        <div className="divide-y divide-gray-100">
          {usuarios.map((u) => (
            <div key={u.id} className="flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white ${
                    u.perfil === 'admin' ? 'bg-amber-500' : 'bg-indigo-500'
                  }`}
                >
                  {u.nome.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-800">{u.nome}</p>
                  <p className="text-xs text-gray-500">{u.email}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {u.perfil === 'admin' ? (
                  <span className="bg-amber-100 text-amber-700 text-xs font-semibold px-2.5 py-1 rounded-full">
                    Admin
                  </span>
                ) : (
                  <div className="flex items-center gap-1.5">
                    {u.permissoes.map((p) => (
                      <span
                        key={p}
                        className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full"
                      >
                        {MODULOS_DISPONIVEIS.find((m) => m.id === p)?.titulo || p}
                      </span>
                    ))}
                  </div>
                )}

                {u.perfil !== 'admin' && (
                  <button
                    onClick={() => handleRemover(u.id)}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                    title="Remover usuário"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modal de criação */}
      {modalAberto && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <UserPlus size={20} className="text-indigo-600" />
                <h3 className="font-bold text-gray-800">Novo Usuário</h3>
              </div>
              <button
                onClick={() => setModalAberto(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCriar} className="p-6 space-y-4">
              {erro && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
                  <AlertCircle size={16} className="flex-shrink-0" />
                  <span>{erro}</span>
                </div>
              )}

              {sucesso && (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-lg">
                  Usuário criado com sucesso!
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome *</label>
                <input
                  type="text"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Nome completo"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">E-mail *</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@exemplo.com"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Senha *</label>
                <input
                  type="password"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Permissões *</label>
                <div className="space-y-2">
                  {MODULOS_DISPONIVEIS.map((modulo) => (
                    <label
                      key={modulo.id}
                      className="flex items-center gap-3 px-4 py-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={permissoes.includes(modulo.id)}
                        onChange={() => togglePermissao(modulo.id)}
                        className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                      />
                      <span className="text-sm text-gray-700">{modulo.titulo}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalAberto(false)}
                  className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-md"
                >
                  Criar Usuário
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConfiguracoesPage;
