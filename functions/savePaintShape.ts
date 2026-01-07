import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { 
      token, 
      fileId, 
      pageNo, 
      clientShapeId, 
      shapeType, 
      dataJson, 
      authorName,
      mode // 'create' or 'update' or 'delete'
    } = await req.json();

    console.log('[savePaintShape] Request:', { token, fileId, pageNo, clientShapeId, shapeType, mode });

    // tokenがある場合はShareLink検証
    if (token) {
      const shareLinks = await base44.asServiceRole.entities.ShareLink.filter({ token });
      if (shareLinks.length === 0) {
        return Response.json({ error: 'Invalid share link' }, { status: 403 });
      }
      
      const shareLink = shareLinks[0];
      
      if (!shareLink.is_active) {
        return Response.json({ error: 'Share link is inactive' }, { status: 403 });
      }
      
      if (shareLink.expires_at && new Date(shareLink.expires_at) < new Date()) {
        return Response.json({ error: 'Share link expired' }, { status: 403 });
      }
      
      if (mode === 'create' && !shareLink.can_post_comments) {
        return Response.json({ error: 'Commenting/painting not allowed' }, { status: 403 });
      }
    }

    // 削除モード
    if (mode === 'delete') {
      const existing = await base44.asServiceRole.entities.PaintShape.filter({ 
        file_id: fileId,
        page_no: pageNo,
        data_json: { $regex: `"id":"${clientShapeId}"` }
      });
      
      if (existing.length > 0) {
        await base44.asServiceRole.entities.PaintShape.delete(existing[0].id);
        console.log('[savePaintShape] Deleted:', existing[0].id);
        return Response.json({ success: true, mode: 'delete', shapeId: existing[0].id });
      }
      
      return Response.json({ success: true, mode: 'delete', message: 'Shape not found' });
    }

    // create or update モード
    const existing = await base44.asServiceRole.entities.PaintShape.filter({ 
      file_id: fileId,
      page_no: pageNo,
      data_json: { $regex: `"id":"${clientShapeId}"` }
    });

    if (existing.length > 0) {
      // Update
      const updated = await base44.asServiceRole.entities.PaintShape.update(existing[0].id, {
        data_json: dataJson,
      });
      
      console.log('[savePaintShape] Updated:', updated.id);
      return Response.json({ 
        success: true, 
        mode: 'update', 
        shapeId: updated.id,
        dbId: updated.id,
        clientShapeId 
      });
    } else {
      // Create
      const created = await base44.asServiceRole.entities.PaintShape.create({
        file_id: fileId,
        share_link_id: token || null,
        page_no: pageNo,
        shape_type: shapeType,
        data_json: dataJson,
        author_name: authorName || 'User',
      });
      
      console.log('[savePaintShape] Created:', created.id);
      return Response.json({ 
        success: true, 
        mode: 'create', 
        shapeId: created.id,
        dbId: created.id,
        clientShapeId 
      });
    }
  } catch (error) {
    console.error('[savePaintShape] Error:', error);
    return Response.json({ 
      error: error.message || 'Unknown error',
      stack: error.stack 
    }, { status: 500 });
  }
});