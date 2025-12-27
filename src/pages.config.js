import Home from './pages/Home';
import QuickCheck from './pages/QuickCheck';
import Projects from './pages/Projects';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Home": Home,
    "QuickCheck": QuickCheck,
    "Projects": Projects,
}

export const pagesConfig = {
    mainPage: "Home",
    Pages: PAGES,
    Layout: __Layout,
};