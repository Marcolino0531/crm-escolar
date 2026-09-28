import { useMemo, useState } from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, ChevronDown, ChevronRight, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ARVORE_PERMISSOES, caminhoDoNo, type NoArvore } from "@/lib/permissoes-arvore";
import {
  alterarNo,
  chavesExpansiveis,
  chavesFiltradas,
  marcacaoDoNo,
  marcarTodos,
  type EstadoFolhas,
  type Marcacao,
} from "@/lib/permissoes-arvore-edicao";

function CaixaTriestado({
  valor,
  disabled,
  rotulo,
  onChange,
}: {
  valor: Marcacao;
  disabled?: boolean;
  rotulo: string;
  onChange: (v: boolean) => void;
}) {
  const checked = valor === "sim" ? true : valor === "parcial" ? "indeterminate" : false;
  return (
    <label className="flex w-24 items-center gap-2 text-xs text-muted-foreground">
      <CheckboxPrimitive.Root
        checked={checked}
        disabled={disabled}
        aria-label={rotulo}
        // Parcial → marcar tudo; marcado → desmarcar tudo.
        onCheckedChange={() => onChange(valor !== "sim")}
        className={cn(
          "grid h-4 w-4 shrink-0 place-content-center rounded-sm border border-primary shadow",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
          "data-[state=indeterminate]:bg-primary/40 data-[state=indeterminate]:text-primary-foreground",
        )}
      >
        <CheckboxPrimitive.Indicator className="grid place-content-center text-current">
          {checked === "indeterminate" ? (
            <Minus className="h-3 w-3" />
          ) : (
            <Check className="h-3 w-3" />
          )}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {rotulo}
    </label>
  );
}

function Linha({
  no,
  nivel,
  estado,
  abertos,
  filtro,
  disabled,
  onToggle,
  onChange,
}: {
  no: NoArvore;
  nivel: number;
  estado: EstadoFolhas;
  abertos: ReadonlySet<string>;
  filtro: ReadonlySet<string> | null;
  disabled?: boolean;
  onToggle: (chave: string) => void;
  onChange: (chave: string, campo: "view" | "edit", v: boolean) => void;
}) {
  if (filtro && !filtro.has(no.chave)) return null;
  const filhos = (no.filhos ?? []).filter((f) => !filtro || filtro.has(f.chave));
  const temFilhos = (no.filhos ?? []).length > 0;
  const aberto = !!filtro || abertos.has(no.chave);
  const m = marcacaoDoNo(no.chave, estado);
  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 border-b border-border/60 py-1.5 pr-2",
          no.tipo === "grupo" && "bg-muted/40 font-semibold",
          no.tipo === "modulo" && "font-medium",
        )}
        style={{ paddingLeft: `${nivel * 20 + 8}px` }}
        data-chave={no.chave}
      >
        {temFilhos ? (
          <button
            type="button"
            className="grid h-5 w-5 place-content-center rounded hover:bg-muted"
            onClick={() => onToggle(no.chave)}
            aria-label={aberto ? "Recolher" : "Expandir"}
          >
            {aberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="h-5 w-5" />
        )}
        <span
          className="flex-1 truncate text-sm"
          title={filtro ? caminhoDoNo(no.chave) : undefined}
        >
          {no.nome}
          {filtro && no.tipo !== "grupo" && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {caminhoDoNo(no.chave)}
            </span>
          )}
        </span>
        {no.acessoEspecial ? (
          <span className="w-48 text-right text-xs text-muted-foreground">
            {no.acessoEspecial === "professor"
              ? "acesso pelo vínculo de professor"
              : "somente Administrador"}
          </span>
        ) : (
          m.gravavel && (
            <>
              <CaixaTriestado
                valor={m.view}
                disabled={disabled}
                rotulo="Visualizar"
                onChange={(v) => onChange(no.chave, "view", v)}
              />
              <CaixaTriestado
                valor={m.edit}
                disabled={disabled}
                rotulo="Editar"
                onChange={(v) => onChange(no.chave, "edit", v)}
              />
            </>
          )
        )}
      </div>
      {aberto &&
        filhos.map((f) => (
          <Linha
            key={f.chave}
            no={f}
            nivel={nivel + 1}
            estado={estado}
            abertos={abertos}
            filtro={filtro}
            disabled={disabled}
            onToggle={onToggle}
            onChange={onChange}
          />
        ))}
    </div>
  );
}

/**
 * Árvore Grupo > Módulo > Página com Visualizar/Editar em cada linha (estilo Sponte).
 * O estado é por folha; pais mostram parcial; marcar um pai marca os filhos.
 */
export function ArvorePermissoes({
  value,
  onChange,
  disabled,
}: {
  value: EstadoFolhas;
  onChange: (next: EstadoFolhas) => void;
  disabled?: boolean;
}) {
  const [termo, setTermo] = useState("");
  const [abertos, setAbertos] = useState<Set<string>>(
    () => new Set(ARVORE_PERMISSOES.map((g) => g.chave)),
  );
  const filtro = useMemo(() => chavesFiltradas(termo), [termo]);

  const toggle = (chave: string) =>
    setAbertos((prev) => {
      const n = new Set(prev);
      if (n.has(chave)) n.delete(chave);
      else n.add(chave);
      return n;
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Filtrar permissões"
          aria-label="Filtrar permissões"
          className="h-8 w-56"
        />
        <div className="ml-auto flex flex-wrap gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => onChange(marcarTodos(true))}
          >
            Marcar todos
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => onChange(marcarTodos(false))}
          >
            Desmarcar todos
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setAbertos(new Set(chavesExpansiveis()))}
          >
            Abrir todos
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setAbertos(new Set())}>
            Fechar todos
          </Button>
        </div>
      </div>
      <div className="rounded-md border border-border">
        {(ARVORE_PERMISSOES as readonly NoArvore[]).map((g) => (
          <Linha
            key={g.chave}
            no={g}
            nivel={0}
            estado={value}
            abertos={abertos}
            filtro={filtro}
            disabled={disabled}
            onToggle={toggle}
            onChange={(chave, campo, v) => onChange(alterarNo(value, chave, campo, v))}
          />
        ))}
        {filtro && filtro.size === 0 && (
          <p className="p-3 text-sm text-muted-foreground">Nenhuma permissão encontrada.</p>
        )}
      </div>
    </div>
  );
}
