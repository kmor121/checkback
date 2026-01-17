import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const ALLOWED_FILES = ['SPEC.md', 'BUGS.md', 'VERIFY.md', 'STATE.md'];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { fileName } = await req.json();

    if (!fileName || !ALLOWED_FILES.includes(fileName)) {
      return Response.json({ error: 'Invalid file name' }, { status: 400 });
    }

    const filePath = `functions/documentation/${fileName}`;
    
    let content;
    try {
      content = await Deno.readTextFile(filePath);
    } catch (error) {
      return Response.json({ error: 'File not found', details: error.message }, { status: 404 });
    }

    return Response.json({ content, fileName });
  } catch (error) {
    console.error('Download error:', error);
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
});