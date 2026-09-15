'use strict';

/**
 * Proteção simples do app: a página em si é pública (só um formulário
 * pedindo senha), mas nenhuma ação de verdade (triagem/investigar/publicar)
 * funciona sem a senha certa no header X-App-Senha.
 *
 * Trocado de HTTP Basic Auth (navegador) pra isso porque colocar
 * usuario:senha@ na URL pra contornar o navegador não abrir o prompt nativo
 * quebra qualquer fetch() feito depois pela própria página (navegadores
 * proíbem fetch() a partir de uma origem com credenciais na URL).
 *
 * Configurar em: APP_SENHA (variável de ambiente).
 *
 * @returns {boolean} true se autorizado. Se false, a resposta 401 já foi
 *   enviada -- o chamador deve só dar `return`.
 */
function exigirSenhaApp(req, res) {
  const senhaEsperada = process.env.APP_SENHA;

  if (!senhaEsperada) {
    console.warn('[APP AUTH] APP_SENHA não configurada -- app fica sem proteção.');
    return true; // fail-open pra não travar o app se esquecer de configurar -- mas loga bem alto
  }

  const senhaRecebida = req.headers['x-app-senha'];
  if (senhaRecebida === senhaEsperada) return true;

  res.status(401).json({ sucesso: false, erro: 'Senha incorreta ou ausente.' });
  return false;
}

module.exports = { exigirSenhaApp };
