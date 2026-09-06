-- Despesas Previstas: move para o próximo dia útil (ou 5º dia útil, no caso de
-- Salário) os lançamentos recorrentes JÁ materializados de outubro/2026 em diante
-- que ainda estão com a data do dia fixo da série. Setembro/2026 e anteriores não
-- são tocados. Gerado por src/lib/fluxo-futuro-dia-util.ts a partir do estado de
-- produção; cada UPDATE confere a data atual e ignora lançamentos pagos.

update public.recurring_forecasts set due_date = '2026-10-13' where id = '5d5a7c9c-e2f8-4116-9338-74e14934d023' and due_date = '2026-10-10' and status <> 'paid'; -- AGE 2026-10
update public.recurring_forecasts set due_date = '2026-10-13' where id = '643a55a1-e3fe-43d8-b68f-06be67c8cde6' and due_date = '2026-10-10' and status <> 'paid'; -- AGE 2026-10
update public.recurring_forecasts set due_date = '2026-10-13' where id = 'e4e9144d-50f6-4b07-8773-a756cedef7b7' and due_date = '2026-10-10' and status <> 'paid'; -- AGE / CEB 2026-10
update public.recurring_forecasts set due_date = '2026-10-13' where id = '24dadc82-70d8-434c-86fb-bf86971ac518' and due_date = '2026-10-10' and status <> 'paid'; -- AGE / NEB 2026-10
update public.recurring_forecasts set due_date = '2026-10-13' where id = '7ebc074f-20c4-4ecf-a59d-dbb6ebfe5f90' and due_date = '2026-10-12' and status <> 'paid'; -- Aluguel 2026-10
update public.recurring_forecasts set due_date = '2026-10-13' where id = '92fc8c06-c65c-4874-b4fb-11e5c86adfbf' and due_date = '2026-10-10' and status <> 'paid'; -- Aluguel 2026-10
update public.recurring_forecasts set due_date = '2026-10-13' where id = '699cd353-cd30-446b-909c-41633206a0fc' and due_date = '2026-10-10' and status <> 'paid'; -- Aluguel 2026-10
update public.recurring_forecasts set due_date = '2026-10-26' where id = '90ad8c76-f0b5-4cef-8942-bb5600533f76' and due_date = '2026-10-25' and status <> 'paid'; -- Aluguel Notebooks 2026-10
update public.recurring_forecasts set due_date = '2026-10-26' where id = 'c636abc7-b422-4aa6-af98-2cf59f9b6a86' and due_date = '2026-10-25' and status <> 'paid'; -- Aluguel Notebooks 2026-10
update public.recurring_forecasts set due_date = '2026-10-13' where id = '6c924685-bc1f-4aaa-9f16-b688b2df50a6' and due_date = '2026-10-10' and status <> 'paid'; -- Aquarela Parques (Parcela 4/13) 2026-10
update public.recurring_forecasts set due_date = '2026-10-13' where id = 'e215007d-9fe6-49d3-9db3-28e0c0858b83' and due_date = '2026-10-10' and status <> 'paid'; -- Ativa 2026-10
update public.recurring_forecasts set due_date = '2026-10-13' where id = '6f8fb65f-9a92-42d6-9060-e3b1eb24faea' and due_date = '2026-10-10' and status <> 'paid'; -- Blink 2026-10
update public.recurring_forecasts set due_date = '2026-10-13' where id = '581d8576-ccaa-46a6-8b97-6a7d6dd00e76' and due_date = '2026-10-10' and status <> 'paid'; -- CEMIG 2026-10
update public.recurring_forecasts set due_date = '2026-10-13' where id = 'ffa7123e-3d8d-4803-9925-4fe11fc52cac' and due_date = '2026-10-11' and status <> 'paid'; -- CEMIG CT 2026-10
update public.recurring_forecasts set due_date = '2026-10-13' where id = 'dda1165c-07f0-445e-8c20-f379f1ae1533' and due_date = '2026-10-10' and status <> 'paid'; -- CEMIG SL1 2026-10
update public.recurring_forecasts set due_date = '2026-10-13' where id = 'b81864d7-5535-463e-8df5-e7f69774a9da' and due_date = '2026-10-11' and status <> 'paid'; -- CEMIG SL2 2026-10
update public.recurring_forecasts set due_date = '2026-10-26' where id = 'aae62ae8-5576-4863-b623-9c812272bd8f' and due_date = '2026-10-25' and status <> 'paid'; -- Clube Certo 2026-10
update public.recurring_forecasts set due_date = '2026-10-26' where id = '0b7b1947-2fbf-4a7f-9aac-e2567ae820db' and due_date = '2026-10-25' and status <> 'paid'; -- Clube Certo 2026-10
update public.recurring_forecasts set due_date = '2026-10-13' where id = '6474f080-92c5-4a9b-9bbf-ef12616cedcb' and due_date = '2026-10-10' and status <> 'paid'; -- Fernando 2026-10
update public.recurring_forecasts set due_date = '2026-10-13' where id = 'acda8d07-9c59-42ba-8465-44d90688d77c' and due_date = '2026-10-10' and status <> 'paid'; -- Fernando 2026-10
update public.recurring_forecasts set due_date = '2026-10-26' where id = '7b4d6b49-6e83-44ab-8e57-ccff81fc5e5b' and due_date = '2026-10-25' and status <> 'paid'; -- Girley Gomes 2026-10
update public.recurring_forecasts set due_date = '2026-10-26' where id = '31c72587-0689-40f3-b5a4-f8bd8ed88ff0' and due_date = '2026-10-25' and status <> 'paid'; -- Impressora 2026-10
update public.recurring_forecasts set due_date = '2026-10-26' where id = '546e1c78-a3a2-4885-ba4c-c8e2d9bceb79' and due_date = '2026-10-25' and status <> 'paid'; -- Impressora 2026-10
update public.recurring_forecasts set due_date = '2026-10-26' where id = '48c3bdec-c6bf-42ee-a1c5-228e4499873f' and due_date = '2026-10-25' and status <> 'paid'; -- Impressora 2026-10
update public.recurring_forecasts set due_date = '2026-10-13' where id = 'df4529f1-705e-424e-bc11-9c6a971f9335' and due_date = '2026-10-10' and status <> 'paid'; -- SAAEMG 2026-10
update public.recurring_forecasts set due_date = '2026-10-13' where id = '2cd891ee-71cd-49c1-86c2-ebf94a395895' and due_date = '2026-10-10' and status <> 'paid'; -- SAAEMG 2026-10
update public.recurring_forecasts set due_date = '2026-10-13' where id = '6238c111-0d65-4036-bca5-889c9db6b6f4' and due_date = '2026-10-10' and status <> 'paid'; -- Sacolão 2026-10
update public.recurring_forecasts set due_date = '2026-10-13' where id = '48050c57-abbf-4702-944f-c5cc91b7498d' and due_date = '2026-10-10' and status <> 'paid'; -- Sacolão 2026-10
update public.recurring_forecasts set due_date = '2026-10-07' where id = '9b686783-babc-4df5-8c33-f507f693dfe7' and due_date = '2026-10-05' and status <> 'paid'; -- Salário 2026-10
update public.recurring_forecasts set due_date = '2026-10-07' where id = '04d20621-e2fc-4d08-860d-9ed07db2d57a' and due_date = '2026-10-05' and status <> 'paid'; -- Salário 2026-10
update public.recurring_forecasts set due_date = '2026-10-07' where id = '5d3d707d-ae03-4b3d-af83-1b0478d179a0' and due_date = '2026-10-05' and status <> 'paid'; -- Salário 2026-10
update public.recurring_forecasts set due_date = '2026-10-26' where id = '9a450e71-38f3-44cb-98c6-ededa0aca5be' and due_date = '2026-10-25' and status <> 'paid'; -- SESC / CEB 2026-10
update public.recurring_forecasts set due_date = '2026-10-26' where id = '1617fa88-0c5e-4821-9998-9e25d3e1e726' and due_date = '2026-10-25' and status <> 'paid'; -- SESC / NEB 2026-10
update public.recurring_forecasts set due_date = '2026-10-13' where id = '22501d32-1243-48a3-97ef-92b77876645e' and due_date = '2026-10-10' and status <> 'paid'; -- Sinpro (Parcela 3/16) 2026-10
update public.recurring_forecasts set due_date = '2026-10-13' where id = '8f462587-cde1-4144-8300-b4c23b9a55f4' and due_date = '2026-10-12' and status <> 'paid'; -- TKE / Peças (Parcela 2/10) 2026-10
update public.recurring_forecasts set due_date = '2026-11-23' where id = '95ab2331-0110-4545-8b72-845a2ae38a41' and due_date = '2026-11-20' and status <> 'paid'; -- Casa do Sol (Parcela 4/5) 2026-11
update public.recurring_forecasts set due_date = '2026-11-23' where id = '38e65a9a-6528-458f-878a-4ea28b3c1851' and due_date = '2026-11-20' and status <> 'paid'; -- Claro 2026-11
update public.recurring_forecasts set due_date = '2026-11-23' where id = '6755416f-c124-4bcc-b292-71a74526d6fe' and due_date = '2026-11-20' and status <> 'paid'; -- FGTS 2026-11
update public.recurring_forecasts set due_date = '2026-11-23' where id = 'ac9c1358-d0a2-4cf5-b87d-0dd9957bcd2a' and due_date = '2026-11-20' and status <> 'paid'; -- FGTS / CEB 2026-11
update public.recurring_forecasts set due_date = '2026-11-23' where id = '2aa41a27-0836-4b19-b794-46eaf8702a01' and due_date = '2026-11-20' and status <> 'paid'; -- FGTS / NEB 2026-11
update public.recurring_forecasts set due_date = '2026-11-23' where id = 'f78d7495-d6bd-4ea8-bc0f-6186cbe93737' and due_date = '2026-11-20' and status <> 'paid'; -- INSS 2026-11
update public.recurring_forecasts set due_date = '2026-11-23' where id = '26efa428-2468-4603-b909-c8eafb3e666f' and due_date = '2026-11-20' and status <> 'paid'; -- INSS / CEB 2026-11
update public.recurring_forecasts set due_date = '2026-11-23' where id = '16b14dcf-6f1b-4c3f-9f28-2d2287bdf0e4' and due_date = '2026-11-20' and status <> 'paid'; -- INSS / CEB 2026-11
update public.recurring_forecasts set due_date = '2026-11-16' where id = '8db38a32-9acd-4b53-9696-d4e4b18ffa92' and due_date = '2026-11-15' and status <> 'paid'; -- IPTU 2026-11
update public.recurring_forecasts set due_date = '2026-11-16' where id = 'f6f0a031-70da-4b01-bc8c-95a34b4298dc' and due_date = '2026-11-15' and status <> 'paid'; -- Marketing 2026-11
update public.recurring_forecasts set due_date = '2026-11-23' where id = 'd0d980ee-31a7-4ac3-8a17-747e642e2bf6' and due_date = '2026-11-20' and status <> 'paid'; -- Operacional 2026-11
update public.recurring_forecasts set due_date = '2026-11-09' where id = '9cdd8bbc-d415-4f79-a2c7-70d4af396005' and due_date = '2026-11-05' and status <> 'paid'; -- Salário 2026-11
update public.recurring_forecasts set due_date = '2026-11-09' where id = 'dfcb495e-6133-4aff-96a3-bdc873d79abc' and due_date = '2026-11-05' and status <> 'paid'; -- Salário 2026-11
update public.recurring_forecasts set due_date = '2026-11-23' where id = '28880e9d-ef0c-4a44-9546-1a3a2dec5ff3' and due_date = '2026-11-20' and status <> 'paid'; -- Simples Nacional 2026-11
update public.recurring_forecasts set due_date = '2026-11-23' where id = 'e966beb1-39ec-442b-a062-7041bf919cd6' and due_date = '2026-11-20' and status <> 'paid'; -- Simples Nacional / CEB 2026-11
update public.recurring_forecasts set due_date = '2026-11-23' where id = '8a66078e-cf87-4c66-9a63-58d669b890f6' and due_date = '2026-11-20' and status <> 'paid'; -- Simples Nacional / NEB 2026-11
update public.recurring_forecasts set due_date = '2026-11-16' where id = '407a94c9-a859-4193-ad62-a6b2b4c4d190' and due_date = '2026-11-15' and status <> 'paid'; -- Sponte 2026-11
update public.recurring_forecasts set due_date = '2026-11-16' where id = '2e7853e5-5d72-4fa6-8eb7-a4594b4b9e52' and due_date = '2026-11-15' and status <> 'paid'; -- Sura 2026-11
update public.recurring_forecasts set due_date = '2026-11-23' where id = '14589a0b-a726-4bc5-9a6a-3a5638dcaea3' and due_date = '2026-11-20' and status <> 'paid'; -- Swile 2026-11
update public.recurring_forecasts set due_date = '2026-11-16' where id = '6f118a4a-bf4e-49f8-88cf-1b81d1c6f44f' and due_date = '2026-11-15' and status <> 'paid'; -- Tecnoponto 2026-11
update public.recurring_forecasts set due_date = '2026-11-16' where id = 'e92ea228-c484-4012-82d2-73c42f569eb9' and due_date = '2026-11-15' and status <> 'paid'; -- Unimed / Cooparticipação 2026-11
update public.recurring_forecasts set due_date = '2026-11-16' where id = 'd32f7afe-a844-4181-b004-9705f430ac79' and due_date = '2026-11-15' and status <> 'paid'; -- Unimed / Mensalidade 2026-11
update public.recurring_forecasts set due_date = '2026-12-14' where id = '728494bb-2399-48f8-baaa-7acc729402b1' and due_date = '2026-12-12' and status <> 'paid'; -- Aluguel 2026-12
update public.recurring_forecasts set due_date = '2026-12-28' where id = 'fa7f30d6-bdc9-4f25-a895-1e7724ebf976' and due_date = '2026-12-25' and status <> 'paid'; -- Aluguel Notebooks 2026-12
update public.recurring_forecasts set due_date = '2026-12-21' where id = 'd7e8110b-7d42-474a-8287-85e72e046619' and due_date = '2026-12-20' and status <> 'paid'; -- Claro 2026-12
update public.recurring_forecasts set due_date = '2026-12-28' where id = '69144ecc-6924-47c6-ae35-b121ffd8e734' and due_date = '2026-12-25' and status <> 'paid'; -- Clube Certo 2026-12
update public.recurring_forecasts set due_date = '2026-12-21' where id = '6b0bc2ee-95ef-4a2f-9cbc-05a8ea0b5cc2' and due_date = '2026-12-20' and status <> 'paid'; -- FGTS 2026-12
update public.recurring_forecasts set due_date = '2026-12-21' where id = '186495e7-b17f-4472-884c-273b409b8d5f' and due_date = '2026-12-20' and status <> 'paid'; -- FGTS / CEB 2026-12
update public.recurring_forecasts set due_date = '2026-12-21' where id = '8b6557a1-6ea8-45ed-919f-eac40143706e' and due_date = '2026-12-20' and status <> 'paid'; -- FGTS / NEB 2026-12
update public.recurring_forecasts set due_date = '2026-12-21' where id = '842893bc-42e3-49fe-b1e3-d17d33a67053' and due_date = '2026-12-19' and status <> 'paid'; -- Folhas A4 2026-12
update public.recurring_forecasts set due_date = '2026-12-28' where id = '62cb2cbe-4d61-4c8d-b538-54f6648ce3d8' and due_date = '2026-12-25' and status <> 'paid'; -- Girley Gomes 2026-12
update public.recurring_forecasts set due_date = '2026-12-28' where id = 'b987baeb-9a52-4043-a62a-9fc36f9cd717' and due_date = '2026-12-25' and status <> 'paid'; -- Impressora 2026-12
update public.recurring_forecasts set due_date = '2026-12-28' where id = '802bc24a-0104-41dd-ab2b-e99a99171b59' and due_date = '2026-12-25' and status <> 'paid'; -- Impressora 2026-12
update public.recurring_forecasts set due_date = '2026-12-21' where id = '142aff9b-a1d5-4b6c-b4c8-9dcc5429e323' and due_date = '2026-12-20' and status <> 'paid'; -- INSS 2026-12
update public.recurring_forecasts set due_date = '2026-12-21' where id = '9f1e5bb1-8690-4098-a19f-1952c6a4b371' and due_date = '2026-12-20' and status <> 'paid'; -- INSS / CEB 2026-12
update public.recurring_forecasts set due_date = '2026-12-21' where id = 'ab849931-0232-439e-bba5-24ea9cb7e137' and due_date = '2026-12-20' and status <> 'paid'; -- INSS / CEB 2026-12
update public.recurring_forecasts set due_date = '2026-12-07' where id = 'a0b7f195-bfe4-413b-b194-181fb1900b2d' and due_date = '2026-12-05' and status <> 'paid'; -- JGF 2026-12
update public.recurring_forecasts set due_date = '2026-12-07' where id = '06395dd1-139e-4649-a3c3-e077259890de' and due_date = '2026-12-05' and status <> 'paid'; -- JGF 2026-12
update public.recurring_forecasts set due_date = '2026-12-21' where id = 'e915abfd-5610-43fb-9097-f215925cb200' and due_date = '2026-12-20' and status <> 'paid'; -- Operacional 2026-12
update public.recurring_forecasts set due_date = '2026-12-07' where id = '69efb0ff-214e-4dfc-83bb-6292a25cd800' and due_date = '2026-12-05' and status <> 'paid'; -- Retirada sócio (a) 2026-12
update public.recurring_forecasts set due_date = '2026-12-07' where id = '783a5f5c-43a5-4547-b970-5ec386e10004' and due_date = '2026-12-05' and status <> 'paid'; -- Retirada Sócio(a) 2026-12
update public.recurring_forecasts set due_date = '2026-12-07' where id = '156d10c3-95e0-41bc-b602-bdd66c63b8f5' and due_date = '2026-12-05' and status <> 'paid'; -- Retirada Sócio(a) 2026-12
update public.recurring_forecasts set due_date = '2026-12-07' where id = '403ceeb0-728b-429c-8697-ff8eb906d3f5' and due_date = '2026-12-05' and status <> 'paid'; -- Salário 2026-12
update public.recurring_forecasts set due_date = '2026-12-07' where id = '837c40d5-c6bf-45e8-9a42-f7c6a1f28238' and due_date = '2026-12-05' and status <> 'paid'; -- Salário 2026-12
update public.recurring_forecasts set due_date = '2026-12-28' where id = '92ba578b-f584-40f7-90f5-4ab72d64ba96' and due_date = '2026-12-25' and status <> 'paid'; -- SESC / CEB 2026-12
update public.recurring_forecasts set due_date = '2026-12-28' where id = 'd2d5c16d-8378-40fa-9ee6-e5f3f08f9574' and due_date = '2026-12-25' and status <> 'paid'; -- SESC / NEB 2026-12
update public.recurring_forecasts set due_date = '2026-12-21' where id = '7b7b5a29-cba3-42eb-aa9d-1ba4c29eb37a' and due_date = '2026-12-20' and status <> 'paid'; -- Simples Nacional 2026-12
update public.recurring_forecasts set due_date = '2026-12-21' where id = 'b6035ff0-5b72-43fe-bb35-9523d9f8d377' and due_date = '2026-12-20' and status <> 'paid'; -- Simples Nacional / CEB 2026-12
update public.recurring_forecasts set due_date = '2026-12-21' where id = 'd5ed8cad-3945-4ab2-b23a-8b92236a2fc2' and due_date = '2026-12-20' and status <> 'paid'; -- Simples Nacional / NEB 2026-12
update public.recurring_forecasts set due_date = '2026-12-21' where id = '4f26ff9b-0303-4790-9f7b-17dce0be8c3d' and due_date = '2026-12-20' and status <> 'paid'; -- Swile 2026-12
update public.recurring_forecasts set due_date = '2026-12-14' where id = '6f61ce30-cfd5-4cab-9810-f31a6213dfe8' and due_date = '2026-12-12' and status <> 'paid'; -- TKE / Peças (Parcela 2/10) 2026-12
update public.recurring_forecasts set due_date = '2027-01-11' where id = 'f9e8e234-396e-48e9-9a0a-a3c46302799d' and due_date = '2027-01-10' and status <> 'paid'; -- Aquarela Parques (Parcela 7/13) 2027-01
update public.recurring_forecasts set due_date = '2027-02-01' where id = '0eda4095-3ead-450f-8160-da91870f1cff' and due_date = '2027-01-30' and status <> 'paid'; -- PGFN (Parcela 8/12) 2027-01
update public.recurring_forecasts set due_date = '2027-01-11' where id = '2ef59136-15d2-422d-b944-f0f7ef2ad51f' and due_date = '2027-01-10' and status <> 'paid'; -- Sinpro (Parcela 6/16) 2027-01
update public.recurring_forecasts set due_date = '2027-03-01' where id = '0da11d33-869f-4135-80a2-c9e0973e26ab' and due_date = '2027-02-28' and status <> 'paid'; -- PGFN (Parcela 9/12) 2027-02
update public.recurring_forecasts set due_date = '2027-04-12' where id = 'cf37af33-ffe9-4c1a-919f-27ea9f5d6a5e' and due_date = '2027-04-10' and status <> 'paid'; -- Aquarela Parques (Parcela 10/13) 2027-04
update public.recurring_forecasts set due_date = '2027-04-12' where id = '63d9fe2a-9199-40d9-a902-8138c856d3d1' and due_date = '2027-04-10' and status <> 'paid'; -- Sinpro (Parcela 9/16) 2027-04
update public.recurring_forecasts set due_date = '2027-05-31' where id = '6f028b11-8d9d-4562-86f9-f4e1b2b40b34' and due_date = '2027-05-30' and status <> 'paid'; -- PGFN (Parcela 12/12) 2027-05
update public.recurring_forecasts set due_date = '2027-06-14' where id = '54ef4b77-66f1-4d92-9501-731e336e3023' and due_date = '2027-06-12' and status <> 'paid'; -- TKE / Peças (Parcela 2/10) 2027-06
update public.recurring_forecasts set due_date = '2027-07-12' where id = 'b263255d-d18d-4480-8ab8-5f51f78aef52' and due_date = '2027-07-10' and status <> 'paid'; -- Aquarela Parques (Parcela 13/13) 2027-07
update public.recurring_forecasts set due_date = '2027-07-12' where id = 'ee126561-fcd5-468e-8584-3b70021dce4c' and due_date = '2027-07-10' and status <> 'paid'; -- Sinpro (Parcela 12/16) 2027-07
update public.recurring_forecasts set due_date = '2027-10-11' where id = 'dd1f28c3-891e-48b0-a3e1-a52147ad0299' and due_date = '2027-10-10' and status <> 'paid'; -- Sinpro (Parcela 15/16) 2027-10
