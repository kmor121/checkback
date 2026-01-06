import AccountSettings from './pages/AccountSettings';
import FileView from './pages/FileView';
import Home from './pages/Home';
import ProjectFiles from './pages/ProjectFiles';
import ProjectNotes from './pages/ProjectNotes';
import ProjectSchedule from './pages/ProjectSchedule';
import ProjectTalk from './pages/ProjectTalk';
import Projects from './pages/Projects';
import QuickCheck from './pages/QuickCheck';
import ShareView from './pages/ShareView';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AccountSettings": AccountSettings,
    "FileView": FileView,
    "Home": Home,
    "ProjectFiles": ProjectFiles,
    "ProjectNotes": ProjectNotes,
    "ProjectSchedule": ProjectSchedule,
    "ProjectTalk": ProjectTalk,
    "Projects": Projects,
    "QuickCheck": QuickCheck,
    "ShareView": ShareView,
}

export const pagesConfig = {
    mainPage: "Home",
    Pages: PAGES,
    Layout: __Layout,
};