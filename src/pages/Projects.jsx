import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Search, FolderOpen, MoreVertical, Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '../utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export default function Projects() {
  const [user, setUser] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showSectionDialog, setShowSectionDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newSectionName, setNewSectionName] = useState('');
  const [selectedSection, setSelectedSection] = useState('');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedProjects, setSelectedProjects] = useState([]);
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', user?.id],
    queryFn: () => base44.entities.Project.filter({ owner_user_id: user?.id }),
    enabled: !!user,
  });

  const { data: sections = [] } = useQuery({
    queryKey: ['sections', user?.id],
    queryFn: () => base44.entities.ProjectSection.list('sort_order'),
    enabled: !!user,
  });

  const createProjectMutation = useMutation({
    mutationFn: (data) => base44.entities.Project.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['projects']);
      setShowCreateDialog(false);
      setNewProjectName('');
      setSelectedSection('');
    },
  });

  const createSectionMutation = useMutation({
    mutationFn: (name) => base44.entities.ProjectSection.create({
      name,
      sort_order: sections.length,
      owner_user_id: user?.id,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries(['sections']);
      setShowSectionDialog(false);
      setNewSectionName('');
    },
  });

  const moveProjectsMutation = useMutation({
    mutationFn: async ({ projectIds, sectionId }) => {
      await Promise.all(
        projectIds.map(id => base44.entities.Project.update(id, { section_id: sectionId }))
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['projects']);
      setSelectionMode(false);
      setSelectedProjects([]);
    },
  });

  const handleCreateProject = () => {
    createProjectMutation.mutate({
      name: newProjectName,
      section_id: selectedSection || null,
      owner_user_id: user?.id,
      status: '未設定',
    });
  };

  const filteredProjects = projects.filter(p => {
    if (searchQuery && !p.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    return true;
  });

  const projectsBySection = sections.reduce((acc, section) => {
    acc[section.id] = filteredProjects.filter(p => p.section_id === section.id);
    return acc;
  }, {});
  const noSectionProjects = filteredProjects.filter(p => !p.section_id);

  const toggleProjectSelection = (projectId) => {
    setSelectedProjects(prev =>
      prev.includes(projectId) ? prev.filter(id => id !== projectId) : [...prev, projectId]
    );
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">プロジェクト</h1>
        <div className="flex gap-2">
          {selectionMode ? (
            <>
              <Select onValueChange={(sectionId) => moveProjectsMutation.mutate({ projectIds: selectedProjects, sectionId })}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="移動先セクション" />
                </SelectTrigger>
                <SelectContent>
                  {sections.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => { setSelectionMode(false); setSelectedProjects([]); }}>
                キャンセル
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setSelectionMode(true)}>
                選択モード
              </Button>
              <Button variant="outline" onClick={() => setShowSectionDialog(true)}>
                セクション管理
              </Button>
              <Button onClick={() => setShowCreateDialog(true)} className="bg-blue-600 hover:bg-blue-700">
                <Plus className="w-4 h-4 mr-2" />
                新規プロジェクト
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 検索・フィルタ */}
      <div className="mb-6 flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="プロジェクトを検索"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="進捗状況" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">すべて</SelectItem>
            <SelectItem value="未設定">未設定</SelectItem>
            <SelectItem value="進行中">進行中</SelectItem>
            <SelectItem value="完了">完了</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* セクション別表示 */}
      {sections.map(section => (
        <div key={section.id} className="mb-8">
          <h2 className="text-xl font-bold mb-4">{section.name}</h2>
          {projectsBySection[section.id]?.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-gray-500">
                このセクションにはプロジェクトがありません
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {projectsBySection[section.id]?.map(project => (
                <Card key={project.id} className={`hover:shadow-lg transition-shadow ${selectedProjects.includes(project.id) ? 'ring-2 ring-blue-500' : ''}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2 flex-1">
                        {selectionMode && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => toggleProjectSelection(project.id)}
                            className="flex-shrink-0"
                          >
                            {selectedProjects.includes(project.id) ? (
                              <Check className="w-4 h-4 text-blue-600" />
                            ) : (
                              <div className="w-4 h-4 border-2 border-gray-300 rounded" />
                            )}
                          </Button>
                        )}
                        <FolderOpen className="w-5 h-5 text-blue-600 flex-shrink-0" />
                        <h3 className="font-semibold truncate">{project.name}</h3>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>設定</DropdownMenuItem>
                          <DropdownMenuItem className="text-red-600">削除</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Badge variant="secondary">{project.status}</Badge>
                    <div className="mt-4 flex gap-2">
                      <Link to={createPageUrl('ProjectTalk') + '?projectId=' + project.id}>
                        <Button variant="outline" size="sm" className="text-xs">トーク</Button>
                      </Link>
                      <Link to={createPageUrl('ProjectFiles') + '?projectId=' + project.id}>
                        <Button variant="outline" size="sm" className="text-xs">ファイル</Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* セクションなし */}
      {noSectionProjects.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-bold mb-4">未分類</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {noSectionProjects.map(project => (
              <Card key={project.id} className={`hover:shadow-lg transition-shadow ${selectedProjects.includes(project.id) ? 'ring-2 ring-blue-500' : ''}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2 flex-1">
                      {selectionMode && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => toggleProjectSelection(project.id)}
                          className="flex-shrink-0"
                        >
                          {selectedProjects.includes(project.id) ? (
                            <Check className="w-4 h-4 text-blue-600" />
                          ) : (
                            <div className="w-4 h-4 border-2 border-gray-300 rounded" />
                          )}
                        </Button>
                      )}
                      <FolderOpen className="w-5 h-5 text-blue-600 flex-shrink-0" />
                      <h3 className="font-semibold truncate">{project.name}</h3>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>設定</DropdownMenuItem>
                        <DropdownMenuItem className="text-red-600">削除</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent>
                  <Badge variant="secondary">{project.status}</Badge>
                  <div className="mt-4 flex gap-2">
                    <Link to={createPageUrl('ProjectTalk') + '?projectId=' + project.id}>
                      <Button variant="outline" size="sm" className="text-xs">トーク</Button>
                    </Link>
                    <Link to={createPageUrl('ProjectFiles') + '?projectId=' + project.id}>
                      <Button variant="outline" size="sm" className="text-xs">ファイル</Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* 新規プロジェクト作成ダイアログ */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新規プロジェクト</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">プロジェクト名</label>
              <Input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="プロジェクト名を入力"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">セクション</label>
              <Select value={selectedSection} onValueChange={setSelectedSection}>
                <SelectTrigger>
                  <SelectValue placeholder="セクションを選択（任意）" />
                </SelectTrigger>
                <SelectContent>
                  {sections.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                キャンセル
              </Button>
              <Button onClick={handleCreateProject} disabled={!newProjectName}>
                作成
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* セクション管理ダイアログ */}
      <Dialog open={showSectionDialog} onOpenChange={setShowSectionDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>セクション管理</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">新規セクション</label>
              <div className="flex gap-2">
                <Input
                  value={newSectionName}
                  onChange={(e) => setNewSectionName(e.target.value)}
                  placeholder="セクション名"
                />
                <Button onClick={() => createSectionMutation.mutate(newSectionName)} disabled={!newSectionName}>
                  追加
                </Button>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">既存のセクション</label>
              <div className="space-y-2">
                {sections.map(s => (
                  <div key={s.id} className="flex items-center justify-between p-2 border rounded">
                    <span>{s.name}</span>
                    <Button variant="ghost" size="sm">編集</Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}