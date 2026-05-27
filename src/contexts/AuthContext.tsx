import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { Usuario, Modulo } from '../types';
import { AUTH_STORAGE_KEY, USUARIOS_STORAGE_KEY, ADMIN_INICIAL } from '../constants';

interface AuthContextType {
  usuario: Usuario | null;
  usuarios: Usuario[];
  login: (email: string, senha: string) => string | null;
  logout: () => void;
  criarUsuario: (dados: Omit<Usuario, 'id' | 'criadoEm'>) => string | null;
  removerUsuario: (id: string) => void;
  temPermissao: (modulo: Modulo) => boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function carregarUsuarios(): Usuario[] {
  try {
    const dados = localStorage.getItem(USUARIOS_STORAGE_KEY);
    if (dados) {
      const lista = JSON.parse(dados) as Usuario[];
      const temAdmin = lista.some((u) => u.id === ADMIN_INICIAL.id);
      if (!temAdmin) {
        lista.unshift(ADMIN_INICIAL);
      }
      return lista;
    }
  } catch {}
  return [ADMIN_INICIAL];
}

function carregarSessao(usuarios: Usuario[]): Usuario | null {
  try {
    const id = localStorage.getItem(AUTH_STORAGE_KEY);
    if (id) {
      return usuarios.find((u) => u.id === id) || null;
    }
  } catch {}
  return null;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [usuarios, setUsuarios] = useState<Usuario[]>(carregarUsuarios);
  const [usuario, setUsuario] = useState<Usuario | null>(() => carregarSessao(carregarUsuarios()));

  const salvarUsuarios = useCallback((lista: Usuario[]) => {
    setUsuarios(lista);
    localStorage.setItem(USUARIOS_STORAGE_KEY, JSON.stringify(lista));
  }, []);

  const login = useCallback(
    (email: string, senha: string): string | null => {
      const encontrado = usuarios.find(
        (u) => u.email.toLowerCase() === email.toLowerCase() && u.senha === senha
      );
      if (!encontrado) {
        return 'E-mail ou senha inválidos.';
      }
      setUsuario(encontrado);
      localStorage.setItem(AUTH_STORAGE_KEY, encontrado.id);
      return null;
    },
    [usuarios]
  );

  const logout = useCallback(() => {
    setUsuario(null);
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }, []);

  const criarUsuario = useCallback(
    (dados: Omit<Usuario, 'id' | 'criadoEm'>): string | null => {
      const emailExistente = usuarios.some(
        (u) => u.email.toLowerCase() === dados.email.toLowerCase()
      );
      if (emailExistente) {
        return 'Este e-mail já está cadastrado.';
      }
      const novo: Usuario = {
        ...dados,
        id: `user-${Date.now()}`,
        criadoEm: new Date().toISOString(),
      };
      const lista = [...usuarios, novo];
      salvarUsuarios(lista);
      return null;
    },
    [usuarios, salvarUsuarios]
  );

  const removerUsuario = useCallback(
    (id: string) => {
      if (id === ADMIN_INICIAL.id) return;
      const lista = usuarios.filter((u) => u.id !== id);
      salvarUsuarios(lista);
    },
    [usuarios, salvarUsuarios]
  );

  const isAdmin = usuario?.perfil === 'admin';

  const temPermissao = useCallback(
    (modulo: Modulo): boolean => {
      if (!usuario) return false;
      if (usuario.perfil === 'admin') return true;
      return usuario.permissoes.includes(modulo);
    },
    [usuario]
  );

  const value = useMemo(
    () => ({
      usuario,
      usuarios,
      login,
      logout,
      criarUsuario,
      removerUsuario,
      temPermissao,
      isAdmin,
    }),
    [usuario, usuarios, login, logout, criarUsuario, removerUsuario, temPermissao, isAdmin]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
