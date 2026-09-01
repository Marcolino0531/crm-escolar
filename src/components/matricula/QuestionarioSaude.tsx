// Etapa 3 do formulário público de matrícula: "Questionário de Saúde".
//
// Nada daqui vai para o Sponte (que não tem campos correspondentes): as
// respostas ficam no School Hub, em `matricula_saude`, e aparecem no painel
// interno de Matrículas.

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CORES_RACAS,
  OPCOES_SAUDE,
  PERGUNTAS_SAUDE,
  type ErrosForm,
  type OpcaoSaude,
  type SaudeForm,
} from "@/lib/matricula-form";

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

      <div className="space-y-1.5">
        <Label htmlFor="saude-emergencia">
          Em caso de emergência, caso não consigamos falar com os pais, qual o contato?
        </Label>
        <Input
          id="saude-emergencia"
          placeholder="Nome, Grau de parentesco, Telefone celular"
          value={saude.contatoEmergencia}
          onChange={(e) => onChange({ ...saude, contatoEmergencia: e.target.value })}
        />
        {erros["saude.contatoEmergencia"] && (
          <p className="text-xs text-destructive">{erros["saude.contatoEmergencia"]}</p>
        )}
      </div>

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
            {resposta.opcao === "Outro" && (
              <Input
                aria-label={`${pergunta} — detalhe`}
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

      <div className="space-y-1.5">
        <Label htmlFor="saude-autorizados">Pessoas autorizadas a buscar a criança na escola</Label>
        <Textarea
          id="saude-autorizados"
          rows={3}
          placeholder="Nome completo, Grau de parentesco, Celular, CPF"
          value={saude.pessoasAutorizadas}
          onChange={(e) => onChange({ ...saude, pessoasAutorizadas: e.target.value })}
        />
        {erros["saude.pessoasAutorizadas"] && (
          <p className="text-xs text-destructive">{erros["saude.pessoasAutorizadas"]}</p>
        )}
      </div>

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
