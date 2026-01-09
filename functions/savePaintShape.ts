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
      authorKey,
      mode // 'create' or 'update' or 'delete' or 'upsert' or 'deleteAll'
    } = await req.json();

    console.log('[savePaintShape] Request:', { token, fileId, pageNo, clientShapeId, shapeType, authorKey, mode });

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

    // DeleteAll mode（全削除）
    if (mode === 'deleteAll') {
      if (!authorKey) {
        return Response.json({ error: 'authorKey is required for deleteAll' }, { status: 400 });
      }

      const allShapes = await base44.asServiceRole.entities.PaintShape.filter({
        file_id: fileId,
        page_no: pageNo,
      });

      let deletedCount = 0;
      
      // admin_all は全削除（管理者権限）
      if (authorKey === 'admin_all') {
        for (const shape of allShapes) {
          try {
            await base44.asServiceRole.entities.PaintShape.delete(shape.id);
            deletedCount++;
          } catch (e) {
            console.error('Failed to delete shape:', shape.id, e);
          }
        }
      } else {
        // 自分の描画のみ削除
        for (const shape of allShapes) {
          try {
            const shapeData = JSON.parse(shape.data_json || '{}');
            if (shapeData.authorKey === authorKey) {
              await base44.asServiceRole.entities.PaintShape.delete(shape.id);
              deletedCount++;
            }
          } catch (e) {
            console.error('Failed to parse/delete shape:', shape.id, e);
          }
        }
      }

      console.log('[savePaintShape] DeleteAll completed:', { authorKey, deletedCount });
      return Response.json({ success: true, deletedCount });
    }

    // 削除モード（単一）
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

    // create/update/upsert モード
    const existing = await base44.asServiceRole.entities.PaintShape.filter({ 
      file_id: fileId,
      page_no: pageNo,
      data_json: { $regex: `"id":"${clientShapeId}"` }
    });

    // authorKeyをdataJsonに埋め込む
    let parsedData = {};
    try {
      parsedData = JSON.parse(dataJson || '{}');
    } catch (e) {
      parsedData = {};
    }
    if (authorKey) {
      parsedData.authorKey = authorKey;
    }
    const finalDataJson = JSON.stringify(parsedData);

    if (existing.length > 0) {
      // Update
      const updated = await base44.asServiceRole.entities.PaintShape.update(existing[0].id, {
        data_json: finalDataJson,
        comment_id: commentId || existing[0].comment_id, // ★ comment_idも更新
      });
      
      console.log('[savePaintShape] Updated:', updated.id, 'comment_id:', commentId);
      return Response.json({ 
        success: true, 
        mode: 'update', 
        shapeId: updated.id,
        dbId: updated.id,
        clientShapeId 
      });
    } else {
      // Create - ★★★ CRITICAL: comment_id を必ず設定 ★★★
      const created = await base44.asServiceRole.entities.PaintShape.create({
        file_id: fileId,
        share_link_id: token || null,
        comment_id: commentId, // ★★★ CRITICAL: これが欠けていた！★★★
        page_no: pageNo,
        shape_type: shapeType,
        data_json: finalDataJson,
        author_name: authorName || 'User',
        author_key: authorKey,
        client_shape_id: clientShapeId,
      });
      
      console.log('[savePaintShape] Created:', created.id, 'comment_id:', commentId);
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