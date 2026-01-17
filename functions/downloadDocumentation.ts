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

    const fileMap = {
      'SPEC.md': 'functions/documentation/SPEC.md',
      'BUGS.md': 'functions/documentation/BUGS.md',
      'VERIFY.md': 'functions/documentation/VERIFY.md',
      'STATE.md': 'functions/documentation/STATE.md'
    };

    const filePath = fileMap[fileName];
    
    let content;
    try {
      // Try reading from the app's root directory
      content = await Deno.readTextFile(filePath);
    } catch (error) {
      // If not found, try alternative paths
      const altPaths = [
        `/${filePath}`,
        `./${filePath}`,
        `../${filePath}`
      ];
      
      let found = false;
      for (const altPath of altPaths) {
        try {
          content = await Deno.readTextFile(altPath);
          found = true;
          break;
        } catch (e) {
          // Continue to next path
        }
      }
      
      if (!found) {
        return Response.json({ 
          error: 'File not found', 
          details: error.message,
          triedPaths: [filePath, ...altPaths]
        }, { status: 404 });
      }
    }

    return Response.json({ content, fileName });
  } catch (error) {
    console.error('Download error:', error);
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
});