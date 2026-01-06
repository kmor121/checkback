import React from 'react';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';

export async function handleOpenFile(file, navigate, onSuccess, onError) {
  try {
    const fileId = file.id;
    
    if (!fileId) {
      const errorMsg = 'ファイルIDが見つかりません';
      console.error(errorMsg, file);
      if (onError) onError(errorMsg);
      return;
    }
    
    if (onSuccess) onSuccess('ファイルを開きます...');
    
    // sessionStorageに一時保存
    sessionStorage.setItem('fileView_fileId', fileId);
    sessionStorage.setItem('fileView_file', JSON.stringify(file));
    
    // navigateで遷移
    if (navigate) {
      navigate(createPageUrl('FileView'));
    } else {
      window.location.href = createPageUrl('FileView');
    }
  } catch (error) {
    console.error('Failed to open file:', error);
    if (onError) onError('ファイルを開けませんでした');
  }
}

export async function handleCopyShareLink(file, onSuccess, onError) {
  try {
    const fileId = file.id;
    
    if (!fileId) {
      const errorMsg = 'ファイルIDが見つかりません';
      console.error(errorMsg, file);
      if (onError) onError(errorMsg);
      return;
    }

    // ShareLinkを検索
    const existingLinks = await base44.entities.ShareLink.filter({ 
      file_id: fileId,
      is_active: true 
    });
    
    let token;
    
    if (existingLinks && existingLinks.length > 0) {
      // 最新のアクティブなリンクを使用
      token = existingLinks[0].token;
    } else {
      // 新規作成
      const newToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      
      const expiresAt = new Date();
      if (file.expires_at) {
        expiresAt.setTime(new Date(file.expires_at).getTime());
      } else {
        expiresAt.setDate(expiresAt.getDate() + 30);
      }
      
      await base44.entities.ShareLink.create({
        file_id: fileId,
        token: newToken,
        is_active: true,
        expires_at: expiresAt.toISOString(),
        password_enabled: false,
        allow_download: true,
        share_latest_only: true,
        can_view_comments: true,
        can_post_comments: true,
      });
      
      token = newToken;
    }
    
    // Canonical URL: /share/:token (ハッシュなし)
    // Canonical URL: ShareView page with token parameter
    const shareUrl = `${window.location.origin}${createPageUrl('ShareView')}?token=${token}`;
    
    // クリップボードにコピー
    try {
      await navigator.clipboard.writeText(shareUrl);
      if (onSuccess) onSuccess('リンクをコピーしました');
    } catch (clipboardError) {
      // フォールバック: textareaを使う
      const textarea = document.createElement('textarea');
      textarea.value = shareUrl;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      
      try {
        document.execCommand('copy');
        if (onSuccess) onSuccess('リンクをコピーしました');
      } catch (fallbackError) {
        if (onError) onError('コピーに失敗しました');
      } finally {
        document.body.removeChild(textarea);
      }
    }
  } catch (error) {
    console.error('Failed to copy share link:', error);
    if (onError) onError('コピーに失敗しました');
  }
}

export async function handleDownloadFile(file, onSuccess, onError) {
  try {
    const fileId = file.id;
    
    if (!fileId || !file.file_url) {
      const errorMsg = 'ファイル情報が見つかりません';
      console.error(errorMsg, file);
      if (onError) onError(errorMsg);
      return;
    }
    
    if (onSuccess) onSuccess('ダウンロードを開始します...');
    
    const link = document.createElement('a');
    link.href = file.file_url;
    link.download = file.original_filename || file.title || 'download';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (error) {
    console.error('Failed to download file:', error);
    if (onError) onError('ダウンロードに失敗しました');
  }
}