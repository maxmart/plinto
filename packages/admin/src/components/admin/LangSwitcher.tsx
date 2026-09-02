import React from 'react';
import { Button } from '../ui/button';
import { usePlinto } from '../../context';

interface LangSwitcherProps {
  activeLang: string;
  onChange: (lang: string) => void;
}

export function LangSwitcher({ activeLang, onChange }: LangSwitcherProps) {
  const { langLabel, config } = usePlinto();
  return (
    <div className="flex gap-1">
      {config.i18n.locales.map((lang: string) => (
        <Button
          key={lang}
          size="sm"
          variant={lang === activeLang ? 'default' : 'outline'}
          onClick={() => onChange(lang)}
        >
          {langLabel(lang)}
        </Button>
      ))}
    </div>
  );
}
