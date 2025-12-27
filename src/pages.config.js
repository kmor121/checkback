import Home from './pages/Home';
import QuickCheck from './pages/QuickCheck';
import Projects from './pages/Projects';
import ProjectTalk from './pages/ProjectTalk';
import ProjectFiles from './pages/ProjectFiles';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Home": Home,
    "QuickCheck": QuickCheck,
    "Projects": Projects,
    "ProjectTalk": ProjectTalk,
    "ProjectFiles": ProjectFiles,
}

export const pagesConfig = {
    mainPage: "Home",
    Pages: PAGES,
    Layout: __Layout,
};