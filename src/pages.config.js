/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import AccountSettings from './pages/AccountSettings';
import AdminDocuments from './pages/AdminDocuments';
import DebugRoutes from './pages/DebugRoutes';
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
    "AdminDocuments": AdminDocuments,
    "DebugRoutes": DebugRoutes,
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