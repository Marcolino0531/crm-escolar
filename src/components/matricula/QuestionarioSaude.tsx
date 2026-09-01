// Etapa 3 do formulário público de matrícula: "Questionário de Saúde".
//
// Nada daqui vai para o Sponte (que não tem campos correspondentes): as
// respostas ficam no School Hub, em `matricula_saude`, e aparecem no painel
// interno de Matrículas.

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CONTATO_EMERGENCIA_VAZIO,
  CORES_RACAS,
  OPCOES_SAUDE,
  PERGUNTAS_SAUDE,
  PESSOA_AUTORIZADA_VAZIA,
  formatarCpf,
  type ContatoEmergencia,
  type ErrosForm,
  type OpcaoSaude,
  type PessoaAutorizada,
  type SaudeForm,
} from "@/lib/matricula-form";
import { formatPhoneBR } from "@/lib/phone";

type Mascara = "telefone" | "cpf";

interface CampoLista<T> {
  chave: keyof T & string;
  rotulo: string;
  mascara?: Mascara;
}

const CAMPOS_CONTATO: readonly CampoLista<ContatoEmergencia>[] = [
  { chave: "nome", rotulo: "Nome" },
  { chave: "telefone", rotulo: "Telefone", mascara: "telefone" },
  { chave: "parentesco", rotulo: "Parentesco" },
];

const CAMPOS_PESSOA: readonly CampoLista<PessoaAutorizada>[] = [
  { chave: "nome", rotulo: "Nome completo" },
  { chave: "telefone", rotulo: "Telefone", mascara: "telefone" },
  { chave: "parentesco", rotulo: "Parentesco" },
  { chave: "cpf", rotulo: "CPF", mascara: "cpf" },
];

function comMascara(valor: string, mascara: Mascara | undefined): string {
  if (mascara === "telefone") return formatPhoneBR(valor);
  if (mascara === "cpf") return formatarCpf(valor);
  return valor;
}

// Lista repetível: nenhuma linha é obrigatória, então a etapa começa sem
// nenhuma e a família adiciona quantas quiser.
function Lista<T extends object>({
  titulo,
  rotuloAdicionar,
  itens,
  vazio,
  campos,
  onChange,
}: {
  titulo: string;
  rotuloAdicionar: string;
  itens: T[];
  vazio: T;
  campos: readonly CampoLista<T>[];
  onChange: (itens: T[]) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{titulo}</Label>
      {itens.map((item, indice) => (
        <div key={indice} className="flex flex-wrap items-end gap-2 rounded-md border p-2">
          {campos.map(({ chave, rotulo, mascara }) => (
            <div key={chave} className="min-w-[9rem] flex-1 space-y-1">
              <span className="text-xs text-muted-foreground">{rotulo}</span>
              <Input
                aria-label={`${titulo} — ${rotulo}`}
                value={item[chave] as string}
                onChange={(e) =>
                  onChange(
                    itens.map((atual, i) =>
                      i === indice
                        ? ({ ...atual, [chave]: comMascara(e.target.value, mascara) } as T)
                        : atual,
                    ),
                  )
                }
              />
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Remover"
            onClick={() => onChange(itens.filter((_, i) => i !== indice))}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...itens, vazio])}>
        <Plus className="mr-1 h-4 w-4" /> {rotuloAdicionar}
      </Button>
    </div>
  );
}

export function QuestionarioSaude({
  saude,
  erros,
  onChange,
}: {
  saude: SaudeForm;
  erros: ErrosForm;
  onChange: (s: SaudeForm) => void;
}) {
  return (
    <section className="space-y-5 rounded-lg border p-4">
      <div>
        <h2 className="font-medium">Questionário de Saúde</h2>
        <p className="text-xs text-muted-foreground">
          Informações que a equipe do colégio precisa ter em mãos no dia a dia do aluno.
        </p>
      </div>

      <Lista
        titulo="Em caso de emergência, caso não consigamos falar com os pais, qual o contato?"
        rotuloAdicionar="Adicionar contato"
        itens={saude.contatosEmergencia}
        vazio={CONTATO_EMERGENCIA_VAZIO}
        onChange={(contatosEmergencia) => onChange({ ...saude, contatosEmergencia })}
        campos={CAMPOS_CONTATO}
      />

      {PERGUNTAS_SAUDE.map(({ campo, pergunta }) => {
        const resposta = saude[campo];
        return (
          <div key={campo} className="space-y-2">
            <Label>{pergunta}</Label>
            <div className="flex flex-wrap gap-4">
              {OPCOES_SAUDE.map((opcao) => (
                <label key={opcao} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={`saude-${campo}`}
                    className="h-4 w-4"
                    checked={resposta.opcao === opcao}
                    onChange={() =>
                      onChange({
                        ...saude,
                        [campo]: { opcao: opcao as OpcaoSaude, detalhe: resposta.detalhe },
                      })
                    }
                  />
                  {opcao}
                </label>
              ))}
            </div>
            {resposta.opcao === "Sim" && (
              <Textarea
                aria-label={`${pergunta} — detalhe`}
                rows={2}
                placeholder="Conte para a equipe do colégio"
                value={resposta.detalhe}
                onChange={(e) =>
                  onChange({ ...saude, [campo]: { ...resposta, detalhe: e.target.value } })
                }
              />
            )}
            {erros[`saude.${campo}`] && (
              <p className="text-xs text-destructive">{erros[`saude.${campo}`]}</p>
            )}
            {erros[`saude.${campo}.detalhe`] && (
              <p className="text-xs text-destructive">{erros[`saude.${campo}.detalhe`]}</p>
            )}
          </div>
        );
      })}

      <Lista
        titulo="Pessoas autorizadas a buscar a criança na escola"
        rotuloAdicionar="Adicionar pessoa"
        itens={saude.pessoasAutorizadas}
        vazio={PESSOA_AUTORIZADA_VAZIA}
        onChange={(pessoasAutorizadas) => onChange({ ...saude, pessoasAutorizadas })}
        campos={CAMPOS_PESSOA}
      />

      <div className="space-y-2">
        <Label>Cor/raça</Label>
        <p className="text-xs text-muted-foreground">Conforme exigência do INEP nº 152/2014.</p>
        <div className="flex flex-wrap gap-4">
          {CORES_RACAS.map((cor) => (
            <label key={cor} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="saude-cor-raca"
                className="h-4 w-4"
                checked={saude.corRaca === cor}
                onChange={() => onChange({ ...saude, corRaca: cor })}
              />
              {cor}
            </label>
          ))}
        </div>
        {erros["saude.corRaca"] && (
          <p className="text-xs text-destructive">{erros["saude.corRaca"]}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="saude-outras">
          Outras informações que os responsáveis considerem importantes
        </Label>
        <Textarea
          id="saude-outras"
          rows={3}
          value={saude.outrasInformacoes}
          onChange={(e) => onChange({ ...saude, outrasInformacoes: e.target.value })}
        />
      </div>
    </section>
  );
}
