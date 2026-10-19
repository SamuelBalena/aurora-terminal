# Aurora Terminal — Registro de Funcionalidades e Diferenciais

> Registro vivo do projeto. **Toda funcionalidade nova entra aqui** (ver "Como manter este arquivo" no fim).
> Build atual: **v23 — vidro dirigido a eventos** · Stack: Electron 37 · React 19 · TypeScript · electron-vite 3 (Vite 6)

---

## 1. Visão geral

Terminal de desktop para Windows com **glassmorphism vivo de verdade** (o fundo do vidro reflete o que está de fato atrás da janela), shell **Git Bash com comandos GNU/Linux reais sem WSL**, abas, temas, histórico persistente e um sistema de comandos personalizados (`/cmd`). Janela frameless 1100×700 com barra própria, botão de fechar e área de arraste.

---

## 2. Terminal & Shell

| Item | Detalhe |
|---|---|
| Shell padrão | **Git Bash** (`bash.exe --login -i`, MSYSTEM=MINGW64) — comandos Linux reais já instalados com o Git, **zero WSL** |
| Fallback | PowerShell nativo se o Git Bash não for encontrado (aviso no log) |
| emulação | xterm.js v6 sobre **ConPTY** (node-pty 1.1.0 — N-API, sem electron-rebuild) |
| Renderer | **WebGL GPU** (`@xterm/addon-webgl`) com atlas de glifos; fallback automático pro DOM renderer se o contexto cair (`onContextLoss`) ou a GPU não existir |
| Fonte | Cascadia Code / Consolas, zoom persistido (Ctrl+=/-/0) |
| Scrollback | 2000 linhas por aba (padrão do VS Code é 1000) |
| Scrollbar | Escondida (o scroll funciona pela rodinha) |
| Links | URLs clicáveis no output (WebLinksAddon) |
| **Neon das letras** | Halo neon ao redor dos glifos (drop-shadow sobre o canvas, cor do tema), **Ctrl+Alt+N** liga/desliga — persistido no config |
| PATHs no Git Bash | Sempre com barras normais (`C:/Users/...`) — barra invertida é escape no bash |

---

## 3. O diferencial central — Vidro vivo dirigido a eventos

O ponto que separa o Aurora da maioria dos terminais: o fundo da janela é o **desktop real de trás, borrado**, e atualiza sozinho — sem loteria de DWM (acrylic/mica do Windows renderizam conforme driver/GPU; aqui o vidro é **construído** e funciona em qualquer máquina).

**Como funciona (v23):**
- A própria janela é marcada com `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` via **koffi** (FFI N-API) — marcação feita **após a janela aparecer**, com verificação lendo de volta + retry (o Windows aceita a chamada antes do show e não aplica — lição paga)
- Resultado: as capturas de tela mostram **só o que está atrás** da janela (sem eco infinito do terminal dentro do próprio vidro)
- **Zero timer de captura**: um `WinEventHook` avisa quando o desktop muda (troca de app em foco, janela abrindo/fechando/minimizando, janela de outro app sendo arrastada, troca de desktop virtual). Cada aviso vira **uma** foto coalescida (dirty flag + espera de ~450ms)
- Digitar no terminal **não dispara foto nenhuma** (teclas não geram eventos de janela); fundo parado = zero capturas
- Foto em 38% da resolução + JPEG q70 (o blur de 14px esconde) + detecção de mudança byte-a-byte (fundo idêntico nem é reenviado)
- Pan ao vivo: arrastar a janela move o reflexo na hora (bounds via IPC); a foto nova chega quando o gesto assenta
- Multi-monitor: captura sempre o display onde a janela está
- Rede de segurança: 1 foto a cada 12s, **só** se a janela estiver sem foco (ex.: vídeo atrás)
- Camadas: tinta única translúcida (tema) + imagem borrada pelo Chromium; o bug clássico do `#000` hardcoded do viewport do xterm é neutralizado por override
- **Bônus de privacidade**: o terminal não aparece em printscreen nem gravação de tela (efeito direto do `EXCLUDEFROMCAPTURE`)

---

## 4. Abas

- Abas independentes com sessão PTY própria por id (`bash 1`, `bash 2`, …)
- Abas ocultas ficam montadas com `display:none`: scrollback e processos **preservados** ao trocar
- Nova aba: **Ctrl+T** ou botão `+` · Fechar: **Ctrl+W** ou ✕ na aba (a última fica) · Ciclar: **Ctrl+Tab / Ctrl+Shift+Tab**
- Barra de abas = área de arraste da janela frameless (as abas/botões não arrastam)
- Trocar tema/fonte/zoom vale para todas as abas na hora

---

## 5. Temas

4 temas com persistência em `config.json` (userData) e troca ao vivo (variáveis CSS no `<html>` + paleta do xterm na hora):

| Tema | Cara |
|---|---|
| **Aurora Dark** | Vidro escuro translúcido, acentos teal/violeta, ANSI GitHub-ish |
| **Aurora Rosé** | Vidro branco frosted, barra clara, ANSI vermelho/rosa legível em fundo claro |
| **Dracula** | Tinta translúcida 28,42,54 + paleta clássica |
| **Catppuccin Mocha** | Vidro 30,30,46 + paleta pastel |

- Troca pelo botão **◐** na barra ou **Ctrl+Alt+T** (cicla)
- Barra e corpo compartilham a MESMA tinta (uma camada só — bar e terminal sempre.uniformes; lição: empilhar tintas escurece)
- Cada tema define também a **cor do neon** das letras (`--neon` na paleta): Dark=teal, Rosé=rosé suave, Dracula=purple, Mocha=lilac

---

## 6. Copiar, colar e atalhos

Padrão **Windows Terminal**:

| Ação | Atalho |
|---|---|
| Copiar (com seleção) | **Ctrl+C** — sem seleção, Ctrl+C = interrupção `\x03` |
| Colar | **Ctrl+V** / Ctrl+Shift+V / **Shift+Insert** / botão direito |
| Botão direito | Copia se houver seleção; cola se não houver |
| **Ctrl+A inteligente** | Seleciona **só o comando** da linha (acha o fim do prompt `$ ` do Git Bash; o prompt fica fora) — 2ª vez = seleciona tudo |
| **Backspace/Delete com seleção** | Apaga o **comando inteiro de uma vez**, na MESMA linha, sem confirmação (via `\x0015` = Ctrl+U nativo do readline) |
| Deleções nativas do readline | Ctrl+U (linha), Ctrl+W (palavra), Alt+D (palavra à frente) |
| **Ctrl+R protegido** | Busca reversa de histórico é do próprio bash (readline) — só bloqueamos o reload do Chromium |
| **Ctrl+Alt+N** | Liga/desliga o **neon das letras** (persistido) |
| Zoom | **Ctrl+= / Ctrl+- / Ctrl+0** (persistido no config) |
| Atalhos do app (nunca vão pro shell) | Ctrl+T, Ctrl+W, Ctrl+Tab, Ctrl+Alt+T, zoom |

Clipboard via IPC do Electron com teto de 1MB e type-check (o `navigator.clipboard` do renderer é imprevisível).

---

## 7. Histórico de comandos

**Delegado ao bash** (decisão anti-briga-com-readline) — setas ↑/↓, dedup e busca nativas:

- `HISTFILE=C:/Users/<user>/.aurora_history` — persistente entre sessões
- `HISTSIZE/HISTFILESIZE=2000` + `HISTCONTROL=ignoreboth` (ignora duplicados seguidos e comandos com espaço inicial)
- `PROMPT_COMMAND='history -a; history -n'` — **flush ao vivo + merge entre abas**: histórico compartilhado entre as abas do app

---

## 8. /help — ajuda viva

- 6 categorias coloridas em ANSI (texto único em `src/shared/helpText.ts`, gerado pro arquivo `aurora-help.ansi` no userData)
- **Impresso pelo próprio bash** (alinhamento e setas perfeitos): o renderer intercepta o Enter e manda ` cat "$AURORA_HELP_ANSI"` (espaço inicial ⇒ `ignorespace` tira do histórico)
- `/help` nunca suja o histórico
- Sessão morta (shell saiu) ⇒ fallback local via `term.write`

## 9. /cmd — comandos personalizados

Sistema de macros persistidas em `userData/custom-commands.json`:

- `/cmd add nome <comando>` — comandos com `;` viram **sequência** (respeitando aspas; executadas uma a uma no mesmo shell — `cd` persiste entre passos)
- `/cmd` lista, `/cmd rm nome` remove, argumentos extras se anexam a comandos de passo único
- Relatório ANSI gerado e lido pelo bash (` cat $AURORA_CMD_ANSI`) — mesmo truque da ajuda
- Sincronizado entre todas as abas na hora (evento IPC `commands:updated`)
- Expansão viva: roda no shell REAL (entra pro histórico limpo); sessão morta imprime local

---

## 10. Performance (stack de otimizações)

| Camada | Medida |
|---|---|
| Render do texto | **WebGL GPU** (era DOM renderer — um elemento por célula, o gargalo clássico do xterm.js) |
| IPC de saída | **Batching de chunks do PTY**: janela de 16ms + teto de 128KB + flush imediato em rajada + flush antes do exit (receita Hyper/Theia) — `ls`/build deixam de virar centenas de mensagens |
| Vidro | **Dirigido a eventos** (v23) — ver seção 3; digitar = zero capturas |
| Vidro — mudança | Foto em 38% da resolução, q70, `Buffer.equals` compara bytes (fundo parado não codifica nem envia nada) |
| Vidro — gestos | Captura pausa durante drag/resize (só pan); bounds coalescidos em rAF (1 por frame, não 1 por evento de mouse) |
| Memória | scrollback 2000; apenas mutations simples |
| Renderer CSS | `.glass-img` com `will-change: transform` (drag = só compositor) |

---

## 11. Robustez & diagnóstico

- **`pty-debug.log`** — caixa-preta na raiz do projeto: boot, ciclo das sessões, decisões do vidro (ex.: `vidro vivo: exclusão CONFIRMADA pelo Windows`, `WinEventHook instalado ✓`)
- **Canário de build** — a primeira linha do terminal carimba a versão do build rodando (`[vidro v23 · eventos]`): prova instantânea do que está de pé
- **`probe-vidro.cjs`** — sonda forense do vidro (lê a affinity real da janela de fora, captura via GDI/BitBlt, mede luminância da região sob o terminal)
- Sessões PTY à prova de remonte: dispose agendado com debounce de 300ms + reaproveitamento por id; guarda de boot (`SESSION_BOOT_MS=2000`) evita eco fantasma de `\r`; todo o app roda **sem `<StrictMode>`** (remonte duplo reacendia PTY)
- Fallbacks silenciosos: koffi indisponível ⇒ vidro estático (nunca crasha o boot); GPU ausente ⇒ DOM renderer; Git Bash ausente ⇒ PowerShell
- Recarga da página varre sessões órfãs (`pty:reset-all`)

---

## 12. Stack técnica

- **Electron 37** + **React 19** + **TypeScript**, build via **electron-vite 3** (Vite 6)
- `node-pty` 1.1.0 (N-API prebuild — **sem electron-rebuild/VS Build Tools**)
- `koffi` 2.16.3 (FFI Win32 N-API: `SetWindowDisplayAffinity`, `GetWindowDisplayAffinity`, `SetWinEventHook`) — carregado por `import()` dinâmico com fallback
- `@xterm/xterm` 6 + addons **fit**, **web-links**, **webgl** 0.19
- Config persistida em `userData/config.json` (tema, fonte)
- Estrutura: `src/main` (processo principal + PTY + vidro) · `src/preload` (ponte IPC tipada) · `src/renderer` (React + xterm) · `src/shared` (helpText, customCommands — lógica pura compartilhada)

---

## 13. Distribuição (instalador .exe)

| Item | Detalhe |
|---|---|
| Gerador | **electron-builder 26** via `npm run dist` (builda e empacota em um comando) |
| Artefato | `dist/AuroraTerminal-Setup-<versão>.exe` — instalador NSIS **one-click, por usuário** (não pede admin) |
| Logo | `resources/logo.png` (quadrada, 515×515) → vira o ícone do .exe, do instalador, do desinstalador e da janela (extraResources + `icon` do BrowserWindow) — nada de ícone do Electron |
| Nativos | `npmRebuild: false` — node-pty/koffi são **N-API prebuilds**: entram no pacote como estão (rebuild só quebraria tudo atrás de Visual Studio desnecessário) |
| asar | `asarUnpack` explícito pro `koffi/build/**`; node-pty (`.node` + ConPTY) desempacotado pelo smart unpack automático |
| Logs no instalado | `pty-debug.log` vai pro **userData** (dentro do app.asar é somente leitura) — diagnóstico de produção continua existindo |
| Testável sem instalar | `dist/win-unpacked/Aurora Terminal.exe` roda direto |

## 14. Marcos da saga

| Versão | Marco |
|---|---|
| v1–v3 | Scaffold, xterm.js integrado, PTY real (Git Bash no lugar do WSL) |
| v4 | O fix do vidro: viewport do xterm tem `#000` hardcoded — override descoberto pela comunidade |
| v6 | Vidro determinístico: desktopCapturer + blur do Chromium (janela opaca — resize nativo sempre) |
| v9–v13 | Saga do "apagar seleção": a solução é o byte do readline (`\u0015`), não xeque-mate em coordenadas |
| v14–15 | Barra/corpo uniformes: tinta ÚNICA (empilhar tintas escurece) |
| v16→18 | Responsividade via ResizeObserver testada e **revertida** a pedido |
| v19→20 | Vidro vivo: marcação de exclusão **após o show** com verificação de volta — o zoom infinito (eco de captura) morre |
| v21 | Performance do vidro: meia-resolução, detecção de fundo parado, pausa em drag, coalescência rAF |
| v22 | WebGL renderer + batching do PTY + scrollback enxuto |
| **v23** | **Vidro dirigido a eventos (WinEventHook): zero captura enquanto você digita** |
| **v24** | **Neon nas letras**: halo via drop-shadow no canvas do terminal, cor por tema, Ctrl+Alt+N |
| **1.0.0** | **Lançamento**: logo própria no lugar do ícone do Electron + instalador `AuroraTerminal-Setup-1.0.0.exe` (NSIS one-click) |

---

## 15. Como manter este arquivo

**Regra única: funcionalidade nova ⇒ seção aqui atualizada no mesmo commit/rodada.**

1. Feature nova entra na seção temática correspondente (ou abre seção nova, se for um pilar)
2. Mudança de comportamento atualiza a seção — o registro descreve o **estado atual**, não o histórico
3. Marcos entram na tabela da seção 13 **só se** forem viradas de arquitetura (como v20 e v23)
4. O canário (`src/renderer/src/Terminal.tsx`, primeira linha) marca o build rodando — mantê-lo sincronizado com a versão daqui
