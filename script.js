document.addEventListener('DOMContentLoaded', async function () {
    // =========================================================
    // CONEXÃO DIRETA VIA API REST DO SUPABASE (SEM BIBLIOTECA EXTERNA)
    // =========================================================
    var SUPABASE_URL = "https://rvqlfpfrhdjbszfhcwpj.supabase.co";
    var SUPABASE_ANON_KEY = "sb_publishable_goH5wgjtyJejXvKYVa1E6A_bU2AYkeX";
    var API_ENDPOINT = SUPABASE_URL + "/rest/v1/agendamentos";

    var HEADERS_DB = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": "Bearer " + SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    };

    var CHAVE_PIX_EMAIL = "bekka.santos77@gmail.com";
    var NOME_RECEBEDOR = "Rebeca Dos Santos Teixeir";
    var CIDADE_RECEBEDOR = "RIO DE JANEIRO";
    var VALOR_RESERVA = "50.00";
    var SENHA_ADMIN = "admin123";

    var agendamentosCache = [];

    // =========================================================
    // GERADOR OFICIAL DE PIX (PADRÃO BANCO CENTRAL + CRC16)
    // =========================================================
    function calcularCRC16(payload) {
        var crc = 0xFFFF;
        for (var i = 0; i < payload.length; i++) {
            crc ^= (payload.charCodeAt(i) << 8);
            for (var j = 0; j < 8; j++) {
                if ((crc & 0x8000) !== 0) {
                    crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
                } else {
                    crc = (crc << 1) & 0xFFFF;
                }
            }
        }
        return crc.toString(16).toUpperCase().padStart(4, '0');
    }

    function formatarCampoEMV(id, valor) {
        var tamanho = String(valor.length).padStart(2, '0');
        return id + tamanho + valor;
    }

    function gerarPixCopiaEColaValido() {
        var gui = formatarCampoEMV("00", "br.gov.bcb.pix");
        var chave = formatarCampoEMV("01", CHAVE_PIX_EMAIL);
        var infoAdicional = formatarCampoEMV("02", "Reserva BkStudio Beauty");
        var contaMerchant = formatarCampoEMV("26", gui + chave + infoAdicional);

        var payloadSemCRC =
            formatarCampoEMV("00", "01") +
            contaMerchant +
            formatarCampoEMV("52", "0000") +
            formatarCampoEMV("53", "986") +
            formatarCampoEMV("54", VALOR_RESERVA) +
            formatarCampoEMV("58", "BR") +
            formatarCampoEMV("59", NOME_RECEBEDOR) +
            formatarCampoEMV("60", CIDADE_RECEBEDOR) +
            formatarCampoEMV("62", formatarCampoEMV("05", "BKSTUDIO50")) +
            "6304";

        return payloadSemCRC + calcularCRC16(payloadSemCRC);
    }

    // =========================================================
    // BANCO DE DADOS NA NUVEM VIA FETCH NATIVO
    // =========================================================
    var CloudDB = {
        sincronizar: async function () {
            try {
                var resposta = await fetch(API_ENDPOINT + "?select=*&order=id.asc", {
                    method: "GET",
                    headers: HEADERS_DB
                });
                if (resposta.ok) {
                    agendamentosCache = await resposta.json();
                }
            } catch (e) {
                console.error("Erro ao sincronizar:", e);
            }
            return agendamentosCache;
        },
        inserir: async function (registro) {
            var resposta = await fetch(API_ENDPOINT, {
                method: "POST",
                headers: HEADERS_DB,
                body: JSON.stringify(registro)
            });

            if (!resposta.ok) {
                var erroTxt = await resposta.text();
                throw new Error("Falha ao salvar (" + resposta.status + "): " + erroTxt);
            }
            await this.sincronizar();
            return registro;
        },
        atualizarDataTurno: async function (id, novaData, novoTurno) {
            var resposta = await fetch(API_ENDPOINT + "?id=eq." + id, {
                method: "PATCH",
                headers: HEADERS_DB,
                body: JSON.stringify({ data: novaData, turno: novoTurno })
            });

            if (!resposta.ok) {
                var erroTxt = await resposta.text();
                throw new Error("Falha ao reagendar: " + erroTxt);
            }
            await this.sincronizar();
        },
        atualizarStatus: async function (id, novoStatus) {
            var resposta = await fetch(API_ENDPOINT + "?id=eq." + id, {
                method: "PATCH",
                headers: HEADERS_DB,
                body: JSON.stringify({ status: novoStatus })
            });

            if (!resposta.ok) {
                var erroTxt = await resposta.text();
                throw new Error("Falha ao atualizar status: " + erroTxt);
            }
            await this.sincronizar();
            return agendamentosCache.find(function (item) {
                return item.id === id;
            });
        },
        remover: async function (id) {
            var resposta = await fetch(API_ENDPOINT + "?id=eq." + id, {
                method: "DELETE",
                headers: HEADERS_DB
            });

            if (!resposta.ok) {
                var erroTxt = await resposta.text();
                throw new Error("Falha ao excluir: " + erroTxt);
            }
            await this.sincronizar();
        },
        buscarPorTelefone: function (telefone) {
            for (var i = agendamentosCache.length - 1; i >= 0; i--) {
                if (agendamentosCache[i].telefone === telefone) {
                    return agendamentosCache[i];
                }
            }
            return null;
        },
        verificarDisponibilidadeDia: function (dataISO, ignorarId) {
            var manhaOcupada = false;
            var tardeOcupada = false;

            agendamentosCache.forEach(function (item) {
                if (item.data === dataISO && item.id !== ignorarId) {
                    if (item.turno === 'Manhã') manhaOcupada = true;
                    if (item.turno === 'Tarde') tardeOcupada = true;
                }
            });

            return {
                manhaOcupada: manhaOcupada,
                tardeOcupada: tardeOcupada,
                diaLotado: manhaOcupada && tardeOcupada
            };
        }
    };

    var modalAgendar = document.getElementById('modalAgendar');
    var modalPix = document.getElementById('modalPix');
    var modalWhatsapp = document.getElementById('modalWhatsapp');
    var modalConsultar = document.getElementById('modalConsultar');
    var modalReagendar = document.getElementById('modalReagendar');
    var modalAdmin = document.getElementById('modalAdmin');
    var mensagemFeedback = document.getElementById('mensagemFeedback');

    var agendamentoEmAndamentoId = null;
    var dataAtualNavegacao = new Date();
    var dataSelecionadaISO = null;

    var gradeDias = document.getElementById('gradeDias');
    var mesAnoAtual = document.getElementById('mesAnoAtual');
    var diaSelecionadoTexto = document.getElementById('diaSelecionadoTexto');

    function isDiaPar(dataISO) {
        if (!dataISO || dataISO.indexOf('-') === -1) return false;
        var partes = dataISO.split('-');
        var diaNumero = parseInt(partes[2], 10);
        return diaNumero % 2 === 0;
    }

    function formatarDataBR(dataISO) {
        if (!dataISO || dataISO.indexOf('-') === -1) return dataISO;
        var partes = dataISO.split('-');
        return partes[2] + '/' + partes[1] + '/' + partes[0];
    }

    function exibirFeedback(htmlTexto) {
        if (!mensagemFeedback) return;
        mensagemFeedback.innerHTML = htmlTexto;
        mensagemFeedback.classList.remove('oculto');
    }

    function atualizarOpcoesTurnos(dataISO, nomeInputRadio, ignorarId) {
        var disp = CloudDB.verificarDisponibilidadeDia(dataISO, ignorarId);
        var radios = document.querySelectorAll('input[name="' + nomeInputRadio + '"]');

        radios.forEach(function (radio) {
            var labelCard = radio.closest('.turno-card');
            var spanBox = labelCard ? labelCard.querySelector('.turno-box') : null;
            var ocupado = (radio.value === 'Manhã' && disp.manhaOcupada) || (radio.value === 'Tarde' && disp.tardeOcupada);

            radio.checked = false;

            if (ocupado) {
                radio.disabled = true;
                if (labelCard) labelCard.classList.add('turno-indisponivel');
                if (spanBox) {
                    spanBox.textContent = (radio.value === 'Manhã' ? '☀️ Manhã' : '🌤️ Tarde') + ' (Ocupado)';
                }
            } else {
                radio.disabled = false;
                if (labelCard) labelCard.classList.remove('turno-indisponivel');
                if (spanBox) {
                    spanBox.textContent = (radio.value === 'Manhã' ? '☀️ Manhã' : '🌤️ Tarde');
                }
            }
        });
    }

    function renderizarCalendario() {
        if (!gradeDias) return;
        gradeDias.innerHTML = '';

        var ano = dataAtualNavegacao.getFullYear();
        var mes = dataAtualNavegacao.getMonth();

        if (mesAnoAtual) {
            mesAnoAtual.textContent = dataAtualNavegacao.toLocaleDateString('pt-BR', {
                month: 'long',
                year: 'numeric'
            });
        }

        var primeiroDiaSemana = new Date(ano, mes, 1).getDay();
        var ultimoDiaMes = new Date(ano, mes + 1, 0).getDate();
        var hoje = new Date();

        for (var i = 0; i < primeiroDiaSemana; i++) {
            var vazio = document.createElement('div');
            vazio.classList.add('dia', 'vazio');
            gradeDias.appendChild(vazio);
        }

        for (var dia = 1; dia <= ultimoDiaMes; dia++) {
            (function (diaAtual) {
                var celula = document.createElement('div');
                celula.classList.add('dia');
                celula.textContent = diaAtual;

                var mesFormatado = String(mes + 1).padStart(2, '0');
                var diaFormatado = String(diaAtual).padStart(2, '0');
                var dataString = ano + '-' + mesFormatado + '-' + diaFormatado;
                var ehPar = diaAtual % 2 === 0;

                if (diaAtual === hoje.getDate() && mes === hoje.getMonth() && ano === hoje.getFullYear()) {
                    celula.classList.add('hoje');
                }

                var disp = CloudDB.verificarDisponibilidadeDia(dataString, null);
                var agendamentosNoDia = agendamentosCache.filter(function (item) {
                    return item.data === dataString;
                });

                if (!ehPar) {
                    celula.classList.add('dia-impar');
                    celula.title = 'Atendimento apenas nos dias pares';
                } else if (disp.diaLotado) {
                    celula.classList.add('dia-lotado');
                    celula.title = 'Sem horários disponíveis neste dia (Manhã e Tarde ocupados)';
                    if (dataSelecionadaISO === dataString) {
                        dataSelecionadaISO = null;
                        if (diaSelecionadoTexto) {
                            diaSelecionadoTexto.textContent = 'Selecione um dia par disponível';
                        }
                    }
                } else {
                    celula.classList.add('dia-par');

                    if (dataSelecionadaISO === dataString) {
                        celula.classList.add('selecionado');
                    }

                    if (agendamentosNoDia.length > 0) {
                        var temConfirmado = agendamentosNoDia.some(function (item) {
                            return item.status === 'Confirmado';
                        });
                        celula.classList.add(temConfirmado ? 'status-confirmado' : 'status-aguardando');
                        var turnoLivre = disp.manhaOcupada ? 'Tarde' : 'Manhã';
                        celula.title = '1 horário ocupado — Turno livre: ' + turnoLivre;
                    } else {
                        celula.title = 'Manhã e Tarde disponíveis';
                    }

                    celula.addEventListener('click', function () {
                        dataSelecionadaISO = dataString;
                        var infoLivre = disp.manhaOcupada ? ' (Apenas Tarde livre)' : (disp.tardeOcupada ? ' (Apenas Manhã livre)' : ' (Manhã e Tarde livres)');
                        if (diaSelecionadoTexto) {
                            diaSelecionadoTexto.textContent = 'Data selecionada: ' + formatarDataBR(dataString) + infoLivre;
                        }
                        renderizarCalendario();
                    });
                }

                gradeDias.appendChild(celula);
            })(dia);
        }
    }

    var btnMesAnterior = document.getElementById('mesAnterior');
    if (btnMesAnterior) {
        btnMesAnterior.addEventListener('click', function () {
            dataAtualNavegacao.setMonth(dataAtualNavegacao.getMonth() - 1);
            renderizarCalendario();
        });
    }

    var btnMesProximo = document.getElementById('mesProximo');
    if (btnMesProximo) {
        btnMesProximo.addEventListener('click', function () {
            dataAtualNavegacao.setMonth(dataAtualNavegacao.getMonth() + 1);
            renderizarCalendario();
        });
    }

    var inputDataAgendamento = document.getElementById('dataAgendamento');
    if (inputDataAgendamento) {
        inputDataAgendamento.addEventListener('change', function () {
            atualizarOpcoesTurnos(this.value, 'turno', null);
        });
    }

    var inputDataAgendamento = document.getElementById('dataAgendamento');
    if (inputDataAgendamento) {
        inputDataAgendamento.addEventListener('change', function () {
            atualizarOpcoesTurnos(this.value, 'turno', null);
        });
    }

    var inputNovaData = document.getElementById('novaData');
    if (inputNovaData) {
        inputNovaData.addEventListener('change', function () {
            var tel = document.getElementById('telefoneReagendar').value.trim();
            var reg = CloudDB.buscarPorTelefone(tel);
            atualizarOpcoesTurnos(this.value, 'novoTurno', reg ? reg.id : null);
        });
    }

    var btnAbrirAgendar = document.getElementById('btnAbrirAgendar');
    if (btnAbrirAgendar && modalAgendar) {
        btnAbrirAgendar.addEventListener('click', async function () {
            if (dataSelecionadaISO && inputDataAgendamento) {
                inputDataAgendamento.value = dataSelecionadaISO;
                atualizarOpcoesTurnos(dataSelecionadaISO, 'turno', null);
            } else {
                atualizarOpcoesTurnos('', 'turno', null);
            }
            modalAgendar.classList.remove('oculto');
            await CloudDB.sincronizar();
            renderizarCalendario();
            if (inputDataAgendamento && inputDataAgendamento.value) {
                atualizarOpcoesTurnos(inputDataAgendamento.value, 'turno', null);
            }
        });
    }

    var btnAbrirConsultar = document.getElementById('btnAbrirConsultar');
    if (btnAbrirConsultar && modalConsultar) {
        btnAbrirConsultar.addEventListener('click', async function () {
            var res = document.getElementById('resultadoConsulta');
            if (res) res.classList.add('oculto');
            modalConsultar.classList.remove('oculto');
            await CloudDB.sincronizar();
        });
    }

    var btnAbrirReagendar = document.getElementById('btnAbrirReagendar');
    if (btnAbrirReagendar && modalReagendar) {
        btnAbrirReagendar.addEventListener('click', async function () {
            if (dataSelecionadaISO && inputNovaData) {
                inputNovaData.value = dataSelecionadaISO;
                atualizarOpcoesTurnos(dataSelecionadaISO, 'novoTurno', null);
            } else {
                atualizarOpcoesTurnos('', 'novoTurno', null);
            }
            modalReagendar.classList.remove('oculto');
            await CloudDB.sincronizar();
            renderizarCalendario();
        });
    }

    document.querySelectorAll('.fechar').forEach(function (botao) {
        botao.addEventListener('click', function () {
            var idModal = botao.getAttribute('data-modal');
            var modalAlvo = document.getElementById(idModal);
            if (modalAlvo) modalAlvo.classList.add('oculto');
        });
    });

    window.addEventListener('click', function (e) {
        if (e.target.classList && e.target.classList.contains('modal')) {
            e.target.classList.add('oculto');
        }
    });

    document.querySelectorAll('input[type="tel"]').forEach(function (input) {
        input.addEventListener('input', function (e) {
            var valor = e.target.value.replace(/\D/g, '');
            if (valor.length > 11) valor = valor.slice(0, 11);
            if (valor.length > 2) valor = '(' + valor.slice(0, 2) + ') ' + valor.slice(2);
            if (valor.length > 10) valor = valor.slice(0, 10) + '-' + valor.slice(10);
            e.target.value = valor;
        });
    });

    var formAgendar = document.getElementById('formAgendar');
    if (formAgendar) {
        formAgendar.addEventListener('submit', async function (e) {
            e.preventDefault();

            var nome = document.getElementById('nome').value.trim();
            var sobrenome = document.getElementById('sobrenome').value.trim();
            var telefone = document.getElementById('telefone').value.trim();
            var data = document.getElementById('dataAgendamento').value;
            var turnoInput = document.querySelector('input[name="turno"]:checked');

            if (!isDiaPar(data)) {
                alert('Atenção: Neste mês o atendimento ocorre apenas nos dias pares. Por favor, escolha um dia par.');
                return;
            }

            if (!turnoInput) {
                alert('Por favor, selecione um turno disponível (Manhã ou Tarde).');
                return;
            }

            await CloudDB.sincronizar();
            var disp = CloudDB.verificarDisponibilidadeDia(data, null);
            if ((turnoInput.value === 'Manhã' && disp.manhaOcupada) || (turnoInput.value === 'Tarde' && disp.tardeOcupada)) {
                alert('Ops! Alguém acabou de reservar esse horário agora mesmo. Escolha outro turno ou data.');
                atualizarOpcoesTurnos(data, 'turno', null);
                renderizarCalendario();
                return;
            }

            var novoRegistro = {
                id: Date.now(),
                nome: nome,
                sobrenome: sobrenome,
                telefone: telefone,
                data: data,
                turno: turnoInput.value,
                status: 'Aguardando Pagamento',
                criado_em: new Date().toLocaleString('pt-BR')
            };

            try {
                await CloudDB.inserir(novoRegistro);
                agendamentoEmAndamentoId = novoRegistro.id;

                formAgendar.reset();
                if (modalAgendar) modalAgendar.classList.add('oculto');
                renderizarCalendario();

                var codigoPixValido = gerarPixCopiaEColaValido();
                var inputCopiaCola = document.getElementById('pixCopiaColaInput');
                var inputChave = document.getElementById('chavePixInput');
                var imgQr = document.getElementById('qrCodeImagem');

                if (inputCopiaCola) inputCopiaCola.value = codigoPixValido;
                if (inputChave) inputChave.value = CHAVE_PIX_EMAIL;
                if (imgQr) {
                    imgQr.src = 'https://qrserver.com' + encodeURIComponent(codigoPixValido);
                }

                if (modalPix) modalPix.classList.remove('oculto');
            } catch (err) {
                alert('Erro ao salvar no banco online: ' + err.message);
            }
        });
    }

    document.querySelectorAll('.btn-copiar').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var targetId = btn.getAttribute('data-target');
            var inputAlvo = document.getElementById(targetId);
            if (!inputAlvo) return;

            inputAlvo.select();
            inputAlvo.setSelectionRange(0, 99999);
            navigator.clipboard.writeText(inputAlvo.value);

            var textoOriginal = btn.textContent;
            btn.textContent = 'Copiado!';
            setTimeout(function () {
                btn.textContent = textoOriginal;
            }, 2000);
        });
    });

    var btnConfirmarPagamento = document.getElementById('btnConfirmarPagamento');
    if (btnConfirmarPagamento) {
        btnConfirmarPagamento.addEventListener('click', async function () {
            if (agendamentoEmAndamentoId) {
                var registroAtualizado = await CloudDB.atualizarStatus(agendamentoEmAndamentoId, 'Aguardando Validação');
                if (registroAtualizado) {
                    var linkWpp = document.getElementById('linkWhatsappComprovante');
                    if (linkWpp) {
                        var msg = 'Segue comprovante de agendamento: ' + registroAtualizado.nome + ' ' + registroAtualizado.sobrenome + ' - Dia ' + formatarDataBR(registroAtualizado.data) + ' (' + registroAtualizado.turno + ')';
                        linkWpp.href = 'https://wa.me' + encodeURIComponent(msg);
                    }
                }
            }

            if (modalPix) modalPix.classList.add('oculto');
            renderizarCalendario();
            if (modalWhatsapp) modalWhatsapp.classList.remove('oculto');
        });
    }

    var btnConcluirFluxo = document.getElementById('btnConcluirFluxo');
    if (btnConcluirFluxo) {
        btnConcluirFluxo.addEventListener('click', function () {
            if (modalWhatsapp) modalWhatsapp.classList.add('oculto');
            exibirFeedback('⏳ Seu agendamento foi registrado e está <strong>Aguardando Validação</strong> do comprovante pela profissional.');
        });
    }

    var formConsultar = document.getElementById('formConsultar');
    if (formConsultar) {
        formConsultar.addEventListener('submit', async function (e) {
            e.preventDefault();
            await CloudDB.sincronizar();

            var telefoneBusca = document.getElementById('telefoneConsulta').value.trim();
            var encontrado = CloudDB.buscarPorTelefone(telefoneBusca);
            var boxResultado = document.getElementById('resultadoConsulta');

            if (!boxResultado) return;
            boxResultado.classList.remove('oculto');

            if (encontrado) {
                var classeTag = 'pendente';
                if (encontrado.status === 'Aguardando Validação') classeTag = 'aguardando';
                if (encontrado.status === 'Confirmado') classeTag = 'confirmado';

                boxResultado.innerHTML = '<strong>Cliente:</strong> ' + encontrado.nome + ' ' + encontrado.sobrenome + '<br><strong>Data:</strong> ' + formatarDataBR(encontrado.data) + ' — <strong>Turno:</strong> ' + encontrado.turno + '<br><strong>Status:</strong> <span class="status-tag ' + classeTag + '">' + encontrado.status + '</span>';
            } else {
                boxResultado.innerHTML = 'Nenhum agendamento encontrado para o telefone <strong>' + telefoneBusca + '</strong>.';
            }
        });
    }

    var formReagendar = document.getElementById('formReagendar');
    if (formReagendar) {
        formReagendar.addEventListener('submit', async function (e) {
            e.preventDefault();
            await CloudDB.sincronizar();

            var telefoneBusca = document.getElementById('telefoneReagendar').value.trim();
            var novaData = document.getElementById('novaData').value;
            var novoTurnoInput = document.querySelector('input[name="novoTurno"]:checked');

            if (!isDiaPar(novaData)) {
                alert('Atenção: Neste mês o atendimento ocorre apenas nos dias pares. Por favor, escolha um dia par.');
                return;
            }

            if (!novoTurnoInput) {
                alert('Por favor, selecione um novo turno disponível (Manhã ou Tarde).');
                return;
            }

            var encontrado = CloudDB.buscarPorTelefone(telefoneBusca);

            if (encontrado) {
                var disp = CloudDB.verificarDisponibilidadeDia(novaData, encontrado.id);
                if ((novoTurnoInput.value === 'Manhã' && disp.manhaOcupada) || (novoTurnoInput.value === 'Tarde' && disp.tardeOcupada)) {
                    alert('Este horário já foi ocupado por outra cliente! Escolha outro turno ou outra data.');
                    atualizarOpcoesTurnos(novaData, 'novoTurno', encontrado.id);
                    return;
                }

                await CloudDB.atualizarDataTurno(encontrado.id, novaData, novoTurnoInput.value);

                formReagendar.reset();
                if (modalReagendar) modalReagendar.classList.add('oculto');
                renderizarCalendario();
                exibirFeedback('Horário reagendado com sucesso para <strong>' + encontrado.nome + '</strong> no dia <strong>' + formatarDataBR(novaData) + '</strong> (' + novoTurnoInput.value + ').');
            } else {
                alert('Telefone não encontrado no banco de dados. Faça primeiro seu agendamento.');
            }
        });
    }

    var btnAbrirAdmin = document.getElementById('btnAbrirAdmin');
    if (btnAbrirAdmin && modalAdmin) {
        btnAbrirAdmin.addEventListener('click', function () {
            modalAdmin.classList.remove('oculto');
        });
    }

    var formLoginAdmin = document.getElementById('formLoginAdmin');
    if (formLoginAdmin) {
        formLoginAdmin.addEventListener('submit', async function (e) {
            e.preventDefault();
            var senhaDigitada = document.getElementById('senhaAdmin').value;
            if (senhaDigitada === SENHA_ADMIN) {
                document.getElementById('adminLoginBox').classList.add('oculto');
                document.getElementById('adminPainelConteudo').classList.remove('oculto');
                await CloudDB.sincronizar();
                renderizarPainelAdmin();
            } else {
                alert('Senha incorreta!');
            }
        });
    }

    function renderizarPainelAdmin() {
        var container = document.getElementById('listaAgendamentosAdmin');
        var contador = document.getElementById('contadorRegistros');

        if (contador) contador.textContent = agendamentosCache.length + ' agendamento(s) na nuvem';
        if (!container) return;
        container.innerHTML = '';

        if (agendamentosCache.length === 0) {
            var vazio = document.createElement('p');
            vazio.style.textAlign = 'center';
            vazio.style.padding = '1.5rem';
            vazio.textContent = 'Nenhum agendamento registrado ainda.';
            container.appendChild(vazio);
            return;
        }

        agendamentosCache.forEach(function (item) {
            var card = document.createElement('div');
            card.classList.add('card-registro-admin');

            var isConfirmado = item.status === 'Confirmado';

            var infoDiv = document.createElement('div');
            infoDiv.classList.add('info-registro');

            var titulo = document.createElement('h4');
            titulo.textContent = item.nome + ' ' + item.sobrenome;

            var detalhes = document.createElement('p');
            detalhes.textContent = '📞 ' + item.telefone + ' | 📅 ' + formatarDataBR(item.data) + ' (' + item.turno + ')';

            var statusSpan = document.createElement('span');
            statusSpan.classList.add('status-tag', isConfirmado ? 'confirmado' : 'aguardando');
            statusSpan.textContent = item.status;

            infoDiv.appendChild(titulo);
            infoDiv.appendChild(detalhes);
            infoDiv.appendChild(statusSpan);

            var acoesDiv = document.createElement('div');
            acoesDiv.classList.add('acoes-registro');

            if (!isConfirmado) {
                var btnValidar = document.createElement('button');
                btnValidar.classList.add('btn-aprovar');
                btnValidar.textContent = '✓ Validar';
                btnValidar.addEventListener('click', async function () {
                    await CloudDB.atualizarStatus(item.id, 'Confirmado');
                    renderizarPainelAdmin();
                    renderizarCalendario();
                });
                acoesDiv.appendChild(btnValidar);
            }

            var btnExcluir = document.createElement('button');
            btnExcluir.classList.add('btn-excluir');
            btnExcluir.textContent = 'Excluir';
            btnExcluir.addEventListener('click', async function () {
                if (confirm('Deseja realmente remover este agendamento?')) {
                    await CloudDB.remover(item.id);
                    renderizarPainelAdmin();
                    renderizarCalendario();
                }
            });
            acoesDiv.appendChild(btnExcluir);

            card.appendChild(infoDiv);
            card.appendChild(acoesDiv);
            container.appendChild(card);
        });
    }

    var btnExportarDB = document.getElementById('btnExportarDB');
    if (btnExportarDB) {
        btnExportarDB.addEventListener('click', function () {
            var dados = JSON.stringify(agendamentosCache, null, 2);
            var blob = new Blob([dados], { type: 'application/json' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'backup-bkstudio-' + new Date().toISOString().slice(0, 10) + '.json';
            a.click();
        });
    }

    renderizarCalendario();
    await CloudDB.sincronizar();
    renderizarCalendario();
});
