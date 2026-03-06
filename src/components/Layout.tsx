import Header from './Header';
import Footer from './Footer';

interface LayoutProps {
    children: React.ReactNode;
    currentDate?: Date;
    onDateChange?: (date: Date) => void;
    onGoToToday?: () => void;
    onOpenPicker?: () => void;
}

export default function Layout({ children, currentDate, onDateChange, onGoToToday, onOpenPicker }: LayoutProps) {
    return (
        <div className="min-h-screen flex flex-col">
            <Header currentDate={currentDate} onDateChange={onDateChange} onGoToToday={onGoToToday} onOpenPicker={onOpenPicker} />
            <main className="flex-1 pt-16">{children}</main>
            <Footer />
        </div>
    );
}
