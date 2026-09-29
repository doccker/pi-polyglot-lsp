// 测试用假 LSP 服务器：didOpen/didChange 后延迟 PUBLISH_DELAY_MS 推送诊断（文本含 BAD 则 1 条），
// 模拟 gopls 这类异步推送、且在 didClose 之后仍可能迟到的服务器。
const PUBLISH_DELAY_MS = 80;
let buffer = Buffer.alloc(0);
const send = (msg) => {
	const body = JSON.stringify({ jsonrpc: '2.0', ...msg });
	process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
};
const publish = (uri, text) =>
	setTimeout(() => {
		const diagnostics = text.includes('BAD')
			? [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, severity: 1, message: 'bad' }]
			: [];
		send({ method: 'textDocument/publishDiagnostics', params: { uri, diagnostics } });
	}, PUBLISH_DELAY_MS);
process.stdin.on('data', (chunk) => {
	buffer = Buffer.concat([buffer, chunk]);
	for (;;) {
		const header_end = buffer.indexOf('\r\n\r\n');
		if (header_end < 0) return;
		const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, header_end).toString())[1]);
		if (buffer.length < header_end + 4 + length) return;
		const msg = JSON.parse(buffer.subarray(header_end + 4, header_end + 4 + length).toString());
		buffer = buffer.subarray(header_end + 4 + length);
		if (msg.method === 'initialize') send({ id: msg.id, result: { capabilities: {} } });
		else if (msg.method === 'shutdown') send({ id: msg.id, result: null });
		else if (msg.method === 'exit') process.exit(0);
		else if (msg.method === 'textDocument/didOpen') publish(msg.params.textDocument.uri, msg.params.textDocument.text);
		else if (msg.method === 'textDocument/didChange') publish(msg.params.textDocument.uri, msg.params.contentChanges[0].text);
	}
});
