'use client';

import { useState, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, getDay, endOfMonth as fnsEndOfMonth, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { getHoliday } from '@/lib/holidays';

export interface MemorialHolidayInfo {
    due_date: string; // 'YYYY-MM-DD'
    recurrence_type: string | null;
}

interface CalendarProps {
    currentDate: Date;
    selectedDate: Date;
    displayMonth?: Date;
    onDateSelect: (date: Date) => void;
    onMonthChange?: (date: Date) => void;
    memorialHolidays?: MemorialHolidayInfo[];
    onYearMonthClick?: () => void;
}

function isMemorialHolidayDate(day: Date, memorialHolidays: MemorialHolidayInfo[]): boolean {
    if (!memorialHolidays || memorialHolidays.length === 0) return false;
    return memorialHolidays.some(m => {
        const dueDate = parseISO(m.due_date);
        dueDate.setHours(0, 0, 0, 0);
        const checkDay = new Date(day);
        checkDay.setHours(0, 0, 0, 0);
        if (checkDay < dueDate) return false;
        if (!m.recurrence_type) {
            return isSameDay(dueDate, day);
        }
        switch (m.recurrence_type) {
            case 'yearly':
                return dueDate.getMonth() === day.getMonth() && dueDate.getDate() === day.getDate();
            case 'monthly':
                return dueDate.getDate() === day.getDate();
            case 'monthly_end':
                return isSameDay(day, fnsEndOfMonth(day));
            case 'weekly':
                return getDay(dueDate) === getDay(day);
            default:
                return isSameDay(dueDate, day);
        }
    });
}

export default function Calendar({ currentDate, selectedDate, displayMonth: propDisplayMonth, onDateSelect, onMonthChange, memorialHolidays, onYearMonthClick }: CalendarProps) {
    const [displayMonth, setDisplayMonth] = useState(propDisplayMonth || currentDate);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [dragStart, setDragStart] = useState<number | null>(null);
    const [touchStart, setTouchStart] = useState<number | null>(null);

    useEffect(() => {
        if (propDisplayMonth) {
            setDisplayMonth(propDisplayMonth);
        }
    }, [propDisplayMonth]);

    const monthStart = startOfMonth(displayMonth);
    const monthEnd = endOfMonth(displayMonth);

    const calendarStart = new Date(monthStart);
    calendarStart.setDate(calendarStart.getDate() - calendarStart.getDay());

    const calendarEnd = new Date(monthEnd);
    const daysToAdd = 6 - calendarEnd.getDay();
    calendarEnd.setDate(calendarEnd.getDate() + daysToAdd);

    const calendarDays = eachDayOfInterval({
        start: calendarStart,
        end: calendarEnd,
    });

    const handlePreviousMonth = () => {
        setIsTransitioning(true);
        setTimeout(() => {
            const newMonth = subMonths(displayMonth, 1);
            setDisplayMonth(newMonth);
            if (onMonthChange) onMonthChange(newMonth);
            setIsTransitioning(false);
        }, 150);
    };

    const handleNextMonth = () => {
        setIsTransitioning(true);
        setTimeout(() => {
            const newMonth = addMonths(displayMonth, 1);
            setDisplayMonth(newMonth);
            if (onMonthChange) onMonthChange(newMonth);
            setIsTransitioning(false);
        }, 150);
    };

    const handleDragStart = (e: React.MouseEvent) => {
        setDragStart(e.clientX);
    };

    const handleTouchStart = (e: React.TouchEvent) => {
        setTouchStart(e.touches[0].clientX);
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        if (touchStart === null) return;
        const diff = e.changedTouches[0].clientX - touchStart;
        const threshold = 50;
        if (diff > threshold) handlePreviousMonth();
        else if (diff < -threshold) handleNextMonth();
        setTouchStart(null);
    };

    const handleDragEnd = (e: React.MouseEvent) => {
        if (dragStart === null) return;
        const diff = e.clientX - dragStart;
        const threshold = 50;
        if (diff > threshold) handlePreviousMonth();
        else if (diff < -threshold) handleNextMonth();
        setDragStart(null);
    };

    const weekDays = ['日', '月', '火', '水', '木', '金', '土'];

    return (
        <div className="calendar">
            <div
                className="card bg-base-100 shadow-xl"
                onMouseDown={handleDragStart}
                onMouseUp={handleDragEnd}
                onMouseLeave={() => setDragStart(null)}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
            >
                <div className="card-body p-4">
                    <div className="flex items-center justify-between mb-4">
                        <button onClick={handlePreviousMonth} className="btn btn-sm btn-circle btn-ghost">
                            <span className="material-icons">chevron_left</span>
                        </button>
                        {onYearMonthClick ? (
                            <button
                                onClick={onYearMonthClick}
                                className="text-lg font-semibold hover:opacity-70 transition-opacity"
                            >
                                {format(displayMonth, 'yyyy年M月', { locale: ja })}
                            </button>
                        ) : (
                            <h3 className="text-lg font-semibold">
                                {format(displayMonth, 'yyyy年M月', { locale: ja })}
                            </h3>
                        )}
                        <button onClick={handleNextMonth} className="btn btn-sm btn-circle btn-ghost">
                            <span className="material-icons">chevron_right</span>
                        </button>
                    </div>

                    <div className="grid grid-cols-7 gap-1 mb-2">
                        {weekDays.map((day) => (
                            <div
                                key={day}
                                className={`text-center text-sm font-semibold p-2 ${day === '日' ? 'text-red-500' : day === '土' ? 'text-blue-500' : ''}`}
                            >
                                {day}
                            </div>
                        ))}
                    </div>

                    <div className={`grid grid-cols-7 gap-1 transition-opacity duration-150 ${isTransitioning ? 'opacity-50' : 'opacity-100'}`}>
                        {calendarDays.map((day, index) => {
                            const isCurrentMonth = isSameMonth(day, displayMonth);
                            const isSelected = isSameDay(day, selectedDate);
                            const isToday = isSameDay(day, new Date());
                            const holiday = getHoliday(day);
                            const isNationalHoliday = holiday !== undefined;
                            const isMemorialHoliday = isCurrentMonth && isMemorialHolidayDate(day, memorialHolidays || []);

                            const isRedDay = day.getDay() === 0 || isNationalHoliday || isMemorialHoliday;
                            const isBlueDay = day.getDay() === 6 && !isNationalHoliday && !isMemorialHoliday;

                            return (
                                <button
                                    key={index}
                                    onClick={() => onDateSelect(day)}
                                    className={`btn btn-sm aspect-square p-0 ${!isCurrentMonth
                                        ? 'btn-ghost text-base-content/30'
                                        : isSelected
                                            ? 'btn-primary ring-4 ring-primary ring-offset-2 font-bold'
                                            : isToday
                                                ? 'btn-ghost bg-primary/20 font-bold'
                                                : 'btn-ghost'
                                        } ${isCurrentMonth ? (isRedDay ? 'text-red-500' : isBlueDay ? 'text-blue-500' : '') : ''}`}
                                >
                                    <div className="flex flex-col items-center">
                                        <span>{format(day, 'd')}</span>
                                        {(holiday || isMemorialHoliday) && isCurrentMonth && (
                                            <span className="text-[8px] leading-tight text-primary">
                                                {holiday ? holiday.name : '●'}
                                            </span>
                                        )}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
