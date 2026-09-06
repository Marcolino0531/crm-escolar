// Texto do modelo "Contrato_Matricula_Rematricula_REVISADO.docx" transcrito
// parágrafo a parágrafo, com os campos «Assim» exatamente como no DOCX. Nada
// aqui é calculado: contrato-matricula.ts preenche os campos e troca os blocos
// de MATERIAL/EXTRAS pelo texto de fallback quando não há contratação.

export type ParagrafoModelo =
  | { tipo: "titulo"; texto: string }
  | { tipo: "paragrafo"; texto: string }
  | { tipo: "bloco"; chave: "matricula" | "mensalidade" | "material" | "extras"; texto: string };

export const TITULO_CONTRATO = "CONTRATO PRESTAÇÃO DE SERVIÇOS EDUCACIONAIS";

export const MODELO_CONTRATO: readonly ParagrafoModelo[] = [
  {
    tipo: "paragrafo",
    texto: "N° DO CONTRATO: «NumeroContrato»",
  },
  {
    tipo: "paragrafo",
    texto:
      "CONTRATADO: «RazaoSocialColegio», inscrita no CNPJ n° «CNPJColegio», localizado em «EnderecoColegio», CEP «CEPColegio», «EmailColegio», doravante denominado CONTRATADO, neste presente ato por seu representante legal, «NomeRepresentanteLegal», assinante ao final. O presente contrato é celebrado em consonância com as normas jurídicas erigidas nos artigos 206, incisos II e III da Constituição Federal, e do Código Civil Brasileiro, artigos 180; 205; 389; 394; 427; 475; 476; 594 e 840, restando inevitável que os termos e valores acordados neste instrumento são de conhecimento pleno e prévio do CONTRATANTE, nos moldes dos dispositivos das Leis 8.078/90, 9.870/99, 9.394/96 e Medidas provisórias aplicáveis.",
  },
  {
    tipo: "paragrafo",
    texto:
      "CONTRATANTE: «NomeResponsavel», inscrito (a) no CPF n° «CPFResponsavel», residente na «EnderecoResponsavel», n° «NumeroEnderecoResponsavel», «CompEnderecoResponsavel», «BairroResponsavel», «CidadeResponsavel»/«EstadoResponsavel», CEP «CEPResponsavel», doravante denominado CONTRATANTE.",
  },
  {
    tipo: "paragrafo",
    texto: "ALUNO (A): «NomeAluno»",
  },
  {
    tipo: "paragrafo",
    texto: "SÉRIE: «CursoAtual»",
  },
  {
    tipo: "titulo",
    texto: "OBJETO:",
  },
  {
    tipo: "paragrafo",
    texto:
      "CLÁUSULA PRIMEIRA – Possui o presente instrumento contratual como objeto a prestação de serviços educacionais pertinentes à série e período escolar, ministrados em conformidade com o currículo próprio, regimento escolar aprovado, homologado ou arquivado pelo competente órgão de ensino, nos termos da Lei n. º 9.394/96, em obediência ao calendário escolar do Estabelecimento de Ensino e ano letivo em vigor.",
  },
  {
    tipo: "titulo",
    texto: "VALIDADE E VIGÊNCIA CONTRATUAL:",
  },
  {
    tipo: "paragrafo",
    texto:
      "CLÁUSULA SEGUNDA – A validade deste contrato e, por consequência da matrícula, dependem da inexistência de débito do aluno beneficiário em anos letivos anteriores, de acordo com a legislação de ensino, incluso a relativa documentação escolar.",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO PRIMEIRO – O presente contrato vigorará da data de sua matrícula até 31 (trinta e um) de dezembro do ano em questão, sendo a observância de suas cláusulas contratuais obrigatórias às partes contratantes.",
  },
  {
    tipo: "titulo",
    texto: "DOCUMENTOS ESCOLARES:",
  },
  {
    tipo: "paragrafo",
    texto:
      "CLÁUSULA TERCEIRA – É obrigação do CONTRATANTE a apresentação e regularidade dos documentos escolares exigidos pela legislação de ensino, arcando com os ônus decorrentes da entrega intempestiva, bem como qualquer falha ou incompletude contidas nos mesmos.",
  },
  {
    tipo: "titulo",
    texto: "MATRÍCULA:",
  },
  {
    tipo: "paragrafo",
    texto:
      "CLÁUSULA QUARTA – O pedido de matrícula será realizado por meio de preenchimento do formulário eletrônico disponibilizado no site/sistema do Colégio, contendo os dados do aluno, do responsável, e as condições de mensalidade, matrícula e material pedagógico selecionadas, os quais, desde já, ficam fazendo parte deste contrato.",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO PRIMEIRO – O Cadastro Escolar será encaminhado para exame e deferimento após a certificação pelo departamento financeiro da CONTRATADA de que o CONTRATANTE se encontra quite com suas obrigações contratuais financeiras, decorrentes de prestação de serviços anteriores, bem como o pagamento da primeira parcela da anuidade escolar, necessário para a celebração e confirmação do contrato e da matrícula.",
  },
  {
    tipo: "titulo",
    texto: "DISCRIMINAÇÃO DE OBRIGAÇÕES:",
  },
  {
    tipo: "paragrafo",
    texto:
      "CLÁUSULA QUINTA – Como serviços mencionados neste contrato, entendem-se os obrigatoriamente prestados a toda turma, série ou ano, coletivamente, de acordo com a legislação de ensino. Não inclusos os facultativos, de caráter opcional ou de grupo.",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO ÚNICO – O aluno beneficiário está sujeito às normas do Regimento da Escola, homologado, aprovado ou arquivado pelos órgãos competentes, consoantes os termos da Lei n. º 9.394/96 (documento à disposição do CONTRATANTE) e comunicados realizados via agenda escolar ou circulares do estabelecimento de Ensino; cujas determinações integram o presente instrumento para fins de aplicação subsidiária e em casos de omissão.",
  },
  {
    tipo: "titulo",
    texto: "SERVIÇOS NÃO COBERTOS:",
  },
  {
    tipo: "paragrafo",
    texto:
      "CLÁUSULA SEXTA – Não estão inclusos neste contrato os serviços especiais de recuperação, reforço, exames especiais ou substitutos, reciclagem, transporte escolar, uniformes, merenda, material didático; de arte e de uso individual obrigatório, apostilas, livros, fornecimento de segundas vias de documentos escolares, aulas extraclasses, passeios turísticos pedagógicos, fantasias para eventos, eventos externos e festas.",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO PRIMEIRO – Os itens citados acima serão comunicados com a antecedência mínima de 5 dias, caso esses serviços sejam contratados para o andamento do trabalho escolar.",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO SEGUNDO – A segunda chamada será realizada em data e hora a ser definida pela supervisão da escola, como também, será cobrada uma taxa pela referida prova aos alunos que não apresentarem atestado médico.",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO TERCEIRO – Por se tratar de serviços não obrigatórios e de opção individual, mediante aceitação do interessado, deverão ser contratados à parte, obrigando-se o estabelecimento de ensino a informar antes o respectivo valor.",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO QUARTO – Os alunos que necessitarem de mediadores para acompanhamento no ambiente escolar e possuírem algum tipo de desconto na mensalidade terão este benefício cancelado, com a incidência do valor integral das mensalidades, a partir do momento em que o mediador for contratado. Excetua-se desta regra os alunos que possuam bolsa de estudos vinculada ao sindicato dos professores (SIMPRO) ou aos auxiliares de administração escolar (SAAEMG).",
  },
  {
    tipo: "titulo",
    texto: "VALORES E FORMA DE PAGAMENTO:",
  },
  {
    tipo: "paragrafo",
    texto:
      "CLÁUSULA SÉTIMA – Conforme art. 1º da Lei nº 9.870/99, o CONTRATANTE pagará integralmente o valor da ANUIDADE relativa à série/ano e período letivo, apurado conforme os valores e condições registrados no ato desta matrícula, a saber:",
  },
  {
    tipo: "bloco",
    chave: "matricula",
    texto:
      "MATRÍCULA: R$«ValorMatricula» («ValorMatriculaExtenso»), parcelada em «NumeroParcelasMatricula»x, com vencimento da 1ª parcela em «DataVencimento1aParcelaMatricula» e demais parcelas com vencimento acompanhando o dia de vencimento da mensalidade, nos meses subsequentes.",
  },
  {
    tipo: "bloco",
    chave: "mensalidade",
    texto:
      "MENSALIDADE: R$«ValorMensalidade», com desconto de «PercentualDesconto»% aplicado, resultando no valor mensal de R$«ValorMensalidadeComDesconto» («ValorMensalidadeComDescontoExtenso»), com vencimento todo dia «DiaVencimentoMensalidade» de cada mês.",
  },
  {
    tipo: "bloco",
    chave: "material",
    texto:
      "MATERIAL PEDAGÓGICO: «ListaMaterialPedagogicoSelecionado», no valor total de R$«ValorTotalMaterialPedagogico», parcelado em «NumeroParcelasMaterialPedagogico»x, conforme condições já aprovadas pela secretaria no ato desta matrícula.",
  },
  {
    tipo: "bloco",
    chave: "extras",
    texto:
      "EXTRAS: «ListaExtrasSelecionados» (podendo incluir Hora Extra, Lanche da Manhã, Lanche da Tarde, Almoço e/ou Jantar), no valor mensal total de R$«ValorTotalExtrasMensal», cobrados juntamente com a mensalidade, enquanto vigente a contratação de cada serviço.",
  },
  {
    tipo: "paragrafo",
    texto:
      "Os EXTRAS contratados no formato de pacote mensal (Hora Extra e/ou Alimentação) têm valor fixo mensal, que não é reduzido nos meses de julho e dezembro mesmo havendo menos dias letivos por férias. Já a contratação avulsa, por dia de uso, tem valor diferenciado (mais elevado que o valor proporcional do pacote mensal) e é cobrada separadamente, sem se integrar ao valor das mensalidades.",
  },
  {
    tipo: "paragrafo",
    texto: "Bolsa de desconto: «PercentualBolsaMensalidade».",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO PRIMEIRO – O pagamento das mensalidades deverá ser efetuado até o dia «DiaVencimentoMensalidade» de cada mês, ou em data pré-estabelecida. O desconto mensal incidente sobre o valor da mensalidade escolar, se existente, deixará de ser aplicado no mês em que o CONTRATANTE não efetue o pagamento dentro do prazo do respectivo vencimento, prevalecendo o valor integral da mensalidade de R$«ValorMensalidade» («ValorMensalidadeExtenso»).",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO SEGUNDO – O pagamento da anuidade pelo CONTRATANTE, se integral, será realizado no ato da matrícula ou em data pré-estabelecida.",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO TERCEIRO – A matrícula será paga em «NumeroParcelasMatricula» parcela(s), conforme escolha do CONTRATANTE no ato da matrícula, servindo a 1ª parcela como sinal, arras e princípio de pagamento, com vencimento em «DataVencimento1aParcelaMatricula». As demais parcelas da matrícula, quando houver, vencerão no mesmo dia de vencimento da mensalidade, nos meses subsequentes. As mensalidades, por sua vez, vencem todo dia «DiaVencimentoMensalidade» de cada mês, ou em data pré-estabelecida, a partir de fevereiro, ou, se posteriormente a fevereiro, a partir do início de vigência do contrato, terminando em dezembro do ano letivo contratado.",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO QUARTO – Até o sétimo dia posterior ao da efetivação da matrícula, o CONTRATANTE poderá cancelar a matrícula, devendo comunicar o fato ao departamento financeiro do Colégio, por e-mail, para que possa ser ressarcido do valor pago a título de matrícula.",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO QUINTO – Em caso de desistência a partir do oitavo dia posterior ao da efetivação da matrícula e anterior ao início das aulas, comunicada nos termos do parágrafo anterior, do CONTRATANTE será retido o percentual de 20% (vinte por cento) da matrícula, a título de contraprestação pelas despesas administrativas incorridas pela CONTRATADA.",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO SEXTO – Após o início do ano letivo, o valor pago referente à matrícula não será ressarcido em casos de desistência, independentemente do motivo. O valor da matrícula corresponde à reserva de vaga e aos custos administrativos iniciais, não sendo passível de devolução após o período mencionado.",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO SÉTIMO – Caso o CONTRATANTE opte por cancelar a matrícula durante o ano letivo, deverá notificar a instituição por e-mail. O CONTRATANTE será responsável pelo pagamento da mensalidade correspondente ao mês subsequente ao cancelamento, independentemente da data em que a solicitação for realizada. O não pagamento dessa mensalidade poderá resultar na aplicação das penalidades previstas neste contrato.",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO OITAVO – A simples infrequência às aulas e/ou não participação nas atividades escolares não desobrigam o CONTRATANTE do pagamento das mensalidades.",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO NONO – Em caso de pagamento integral da anuidade, o CONTRATANTE que solicitar o cancelamento da matrícula possui reembolso das parcelas dos meses subsequentes ao pedido de cancelamento. Será retido o percentual de 10% (dez por cento) das parcelas remanescentes, a título de contraprestação pelas despesas administrativas incorridas pela CONTRATADA.",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO DÉCIMO – Em caso de início no decorrer do ano letivo, o valor referente a matrícula poderá ser pré-estabelecido entre as partes, sendo este valor estabelecido como vigente e substituto ao valor presente neste contrato.",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO DÉCIMO PRIMEIRO – O ressarcimento de valores será realizado no prazo máximo de até 30 (trinta) dias corridos, contados a partir da data de solicitação formal pelo responsável financeiro.",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO DÉCIMO SEGUNDO – Em caso de inadimplência superior a 60 (sessenta) dias relativa exclusivamente aos valores de EXTRAS (Hora Extra, Lanche da Manhã, Lanche da Tarde, Almoço e/ou Jantar), fica a CONTRATADA autorizada a cancelar automaticamente a prestação desses serviços específicos, independentemente de notificação prévia, permanecendo o aluno matriculado exclusivamente no horário curricular contratado. O cancelamento dos EXTRAS não afeta a matrícula do aluno nem gera rescisão deste contrato, e não exime o CONTRATANTE do pagamento dos valores já vencidos e não pagos referentes aos extras até a data do cancelamento.",
  },
  {
    tipo: "titulo",
    texto: "CLÁUSULA PENAL:",
  },
  {
    tipo: "paragrafo",
    texto:
      "CLÁUSULA OITAVA – Havendo atraso no pagamento da(s) parcela(s), o contratante arcará com os seguintes acréscimos:",
  },
  {
    tipo: "paragrafo",
    texto: "I. 2% (dois por cento) no valor integral da dívida como multa de mora ao ano.",
  },
  {
    tipo: "paragrafo",
    texto:
      "II. Por dia de atraso, além da multa, juros de mora de 0,034% (trinta e quatro milésimos por cento) ou o valor principal multiplicado por 0,00034 (trinta e quatro centésimos de milésimos por cento).",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO PRIMEIRO – O acréscimo de juros terá o limite de 12% (doze por cento), não mais crescendo em cada período de 12 (doze) meses, Código Civil, Art. 406; Código Tributário Nacional, Art. 161, § 1º.",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO SEGUNDO – (Correção monetária) – quando o atraso for igual ou superior a 90 (noventa) dias, antes do cálculo e aplicação da multa e dos juros, o valor principal será corrigido pelo INPC/IBGE ou, na sua falta, desconhecimento ou não publicação, por outro índice oficial de inflação, acumulado desde a data de vencimento da parcela.",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO TERCEIRO – Em caso de inadimplência superior a 90 (noventa) dias, o responsável financeiro pelo aluno (a) fica sujeito a inscrição do seu nome nos cadastros de restrição ao crédito como SPC e SERASA.",
  },
  {
    tipo: "titulo",
    texto: "RESCISÃO POR DÉBITO:",
  },
  {
    tipo: "paragrafo",
    texto:
      "CLÁUSULA NONA – Após 90 (noventa) dias de atraso, sem prejuízo do previsto em lei quanto à continuidade de frequência do aluno no respectivo período letivo ou, se for o caso, da expedição de transferência, o (a) contratado poderá rescindir o presente contrato independentemente de notificação, ficando o(s) contratante(s) responsável(is) pelo pagamento da multa contratual, do débito existente, dos prejuízos pelo inadimplente (Art. 476, Cód. Civil).",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO PRIMEIRO – O contratante ficará ainda obrigado ao pagamento da(s) parcela(s) que tiverem vencimento enquanto o aluno frequentar o estabelecimento de ensino da contratada.",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO SEGUNDO – Poderá, ainda, a CONTRATADA, em caso de inadimplência do CONTRATANTE de 01 (uma) prestação, emitir e levar a protesto como também, incluir nos cadastros restritivos de créditos (CINEB, SPC, SERASA, etc.) com o conhecimento e autorização, desde já, do CONTRATANTE, título de crédito e/ou formalizar contrato de confissão de dívida, no valor total das mensalidades vencidas e não pagas, bem como das vincendas, acrescendo aos valores devidos, multa e juros, de acordo com o previsto no caput desta cláusula, ficando a critério da CONTRATADA promover a cobrança judicial ou extrajudicial do débito.",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO TERCEIRO – Independentemente da adoção das medidas acima vertidas, fica facultada a CONTRATADA valer-se de empresa especializada para proceder à cobrança, extrajudicial ou judicial, dos débitos, arcando o CONTRATANTE com as despesas e honorários advocatícios correspondentes.",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO QUARTO – Para pagamento de dívidas correspondentes há anos letivos anteriores, tornar-se-á como base de cálculo o valor da prestação da época, bem como os acréscimos previstos no contrato do respectivo ano letivo.",
  },
  {
    tipo: "titulo",
    texto: "RESCISÃO:",
  },
  {
    tipo: "paragrafo",
    texto:
      "CLÁUSULA DÉCIMA – Poderá este instrumento ser rescindido, a qualquer tempo, pelo CONTRATANTE, através de desistência formal, ou seja, por e-mail do Colégio (ex: pedido de guia de transferência para outro estabelecimento de ensino, cancelamento de matrícula, dentre outros) ou pela CONTRATADA, quando infringida pelo CONTRATANTE e/ou aluno beneficiário os dispositivos do regimento interno da instituição.",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO PRIMEIRO – Em caso de cancelamento do presente contrato por parte do CONTRATANTE, este compromete-se a efetuar o pagamento integral das mensalidades referentes ao mês em que foi solicitado o cancelamento, bem como da parcela do mês subsequente.",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO SEGUNDO – Enquanto não for apresentado o requerimento de desistência referido nesta Cláusula, o contrato permanece íntegro, responsáveis os contratantes pelo pagamento das parcelas vincendas, mesmo que o aluno abandone ou não frequente as atividades escolares.",
  },
  {
    tipo: "titulo",
    texto: "OBRIGAÇÕES DO ALUNO:",
  },
  {
    tipo: "paragrafo",
    texto:
      "CLÁUSULA DÉCIMA PRIMEIRA – O aluno beneficiário deste contrato deverá observar os princípios, comportamento e conduta éticos, morais, disciplinares e de respeito às normas de boa convivência coletiva e a qualquer integrante da comunidade escolar, necessários e compatíveis ao desenvolvimento da educação e ensino sérios, sob pena de expedição de transferência pelo estabelecimento de ensino.",
  },
  {
    tipo: "titulo",
    texto: "RENOVAÇÃO DA MATRÍCULA:",
  },
  {
    tipo: "paragrafo",
    texto:
      "CLÁUSULA DÉCIMA SEGUNDA – Nos moldes do art. 5º da Lei n. º 9.870/99, por ninguém estar obrigado a contratar, manter ou renovar contrato, por consistir a escola particular opção do aluno e responsável legais, a CONTRATADA poderá não aceitar a renovação da matrícula para o ano ou período letivo seguinte, quando da existência de débito relativo a ano ou período anterior, assim como, em razão de norma prevista no regimento escolar, por motivo disciplinar ou qualquer outro que não recomende a permanência do aluno em virtude de prejuízo a ele, ao estabelecimento de ensino ou ao relacionamento entre este e o CONTRATANTE ou comunidade escolar.",
  },
  {
    tipo: "titulo",
    texto: "DESLIGAMENTO E TRANSFERÊNCIA:",
  },
  {
    tipo: "paragrafo",
    texto:
      "CLÁUSULA DÉCIMA TERCEIRA – Não será devida a parcela com vencimento posterior ao trigésimo dia da data em que o aluno beneficiário, efetivamente, se desligar do Estabelecimento de Ensino. Os pedidos de transferência, de cancelamento e desistência de matrícula deverão ser requeridos por e-mail pelo CONTRATANTE, através de documento próprio reservado para tal fim e na ficha de matrícula do aluno beneficiário, a depender da concessão definitiva da garantia de quitação de débitos, casos existentes, e/ou da satisfação das obrigações escolares perante a Secretaria da CONTRATADA.",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO ÚNICO – Quando o aluno beneficiário se transferir para a CONTRATADA após o início do ano letivo ficará o CONTRATANTE obrigado ao pagamento das parcelas com vencimento a partir do mês em que começar a frequentar o estabelecimento.",
  },
  {
    tipo: "titulo",
    texto: "DIVULGAÇÃO:",
  },
  {
    tipo: "paragrafo",
    texto:
      "CLÁUSULA DÉCIMA QUARTA – Fica a CONTRATADA autorizada, desde já, livre de qualquer ônus, pelo CONTRATANTE e responsável pelo aluno beneficiário, a utilizar-se da imagem deste para fins exclusivos de divulgação, da CONTRATADA e de suas atividades, podendo tanto reproduzi-la, como divulgá-la junto à internet, jornais, TV, bem como todos os demais meios de comunicação pública ou privada.",
  },
  {
    tipo: "titulo",
    texto: "TRAJES:",
  },
  {
    tipo: "paragrafo",
    texto:
      "CLÁUSULA DÉCIMA QUINTA – É terminantemente vedado ao aluno beneficiário assistir as aulas, ou praticar qualquer outra atividade, bem como permanecer nas instalações da CONTRATADA sem o devido uniforme padrão.",
  },
  {
    tipo: "titulo",
    texto: "SERVIÇO MÉDICO HOSPITALAR:",
  },
  {
    tipo: "paragrafo",
    texto:
      "CLÁUSULA DÉCIMA SEXTA – O CONTRATANTE ou responsável indicará expressamente, a clínica, hospital ou médico a que preferencialmente deverá ser encaminhado o aluno beneficiário, em caso de emergência. Se necessário o CONTRATANTE poderá escolher outro estabelecimento para encaminhar a criança.",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO ÚNICO – Caso não haja indicação referida na Cláusula anterior, fica desde já a CONTRATADA autorizada a encaminhar o aluno beneficiário a um serviço de emergência, responsabilizando-se o CONTRATANTE ou responsável pelas despesas que porventura vierem a ser realizadas. Aplica-se também aos casos em que a clínica, hospital ou médico não prestarem os serviços necessários.",
  },
  {
    tipo: "titulo",
    texto: "DISPOSIÇÕES GERAIS:",
  },
  {
    tipo: "paragrafo",
    texto:
      "CLÁUSULA DÉCIMA SÉTIMA – Na hipótese de discussão judicial do presente contrato, permanecerá o CONTRATANTE com a obrigação de adimplemento do valor contratado, ficando a suspensão de pagamento das parcelas mensais condicionado à ordem judicial ou sentença transitada em julgado.",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO ÚNICO – Em caso de interpretação divergente de dispositivo de lei, entre a CONTRATADA e os órgãos de defesa do consumidor, fica facultado a CONTRATADA recorrer ao Poder Judiciário, prevalecendo à interpretação da instituição, até a decisão judicial transitada em julgado.",
  },
  {
    tipo: "titulo",
    texto: "OBJETOS DE USO PESSOAL:",
  },
  {
    tipo: "paragrafo",
    texto:
      "CLÁUSULA DÉCIMA OITAVA – Os objetos de propriedade e uso pessoal do aluno na escola, bem como equipamentos eletrônicos, joias, dinheiro, acessórios de adorno, são de inteira responsabilidade do usuário. A escola não se responsabiliza pela perda, roubo ou abandono dos mesmos.",
  },
  {
    tipo: "titulo",
    texto: "NORMAS INTERNAS:",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO PRIMEIRO – Em caso de mudança de endereço, os pais ou responsáveis deverão comunicar a Escola com a máxima brevidade.",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO SEGUNDO – Os pais ou responsáveis terão uma tolerância de no máximo 15 (quinze) minutos, após os horários estipulados no ato da matrícula para buscarem seus filhos nas dependências do Colégio. Deixando o CONTRATANTE livre para cobrar as devidas horas extras em caso de eventuais atrasos.",
  },
  {
    tipo: "paragrafo",
    texto:
      "PARÁGRAFO TERCEIRO – Após a referida tolerância, se o aluno permanecer nas dependências do Colégio, será cobrado um valor no percentual de 5% (cinco por cento) do valor referido à hora aula do aluno, por cada hora ou fração de minutos que o aluno permanecer nas dependências do Colégio, sendo o referido valor, revertido para pagamento de horas extras dos funcionários, que vão ficar responsáveis pela guarda e segurança do aluno, até a chegada do pai ou responsável.",
  },
  {
    tipo: "paragrafo",
    texto: "Atenção: VISANDO O CORRETO ANDAMENTO DA INSTITUIÇÃO, A ESCOLA NÃO ABRIRÁ PRECEDENTE.",
  },
  {
    tipo: "titulo",
    texto: "FORO COMPETENTE:",
  },
  {
    tipo: "paragrafo",
    texto:
      "CLÁUSULA VIGÉSIMA – Os contratantes elegem o foro da comarca de Belo Horizonte, com renúncia expressa de qualquer outro, por mais privilegiado que seja, para dirimir as dúvidas porventura existentes, atribuindo ao presente instrumento plena eficácia e força executiva Judicial.",
  },
  {
    tipo: "paragrafo",
    texto:
      "E, por estarem, assim, justos e contratados, obrigam-se a cumprir e observar fielmente em todos os seus termos, as cláusulas supracitadas, e demais disposições ora contratadas, assinando o presente instrumento na presença de duas testemunhas que também assinam ao final.",
  },
  {
    tipo: "paragrafo",
    texto:
      "Eu abaixo assinado, requeiro a matrícula do(a) aluno(a) acima identificado, declarando estar de acordo com as disposições do Regimento Escolar do Estabelecimento e normas complementares. Assumo inteira responsabilidade pelas informações citadas nesta ficha.",
  },
];
