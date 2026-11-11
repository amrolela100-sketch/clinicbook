import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import { describe, it, expect } from 'vitest';
import { DoctorCard } from '@/components/public-pages';
import type { Doctor } from '@/lib/types';

const doctor: Doctor = {
  id: 'doctor-4',
  name: 'رنا الشامي',
  specialty: 'الأمراض الجلدية',
  organizationId: 'org-1',
  clinicId: 'clinic-1',
  clinic: 'مركز الحياة الطبي',
  city: 'دمشق',
  district: 'أبو رمانة',
  fee: 25,
  followUpFee: 10,
  rating: 4.6,
  reviews: 77,
  experience: 14,
  bio: 'اختصاصية في الأمراض الجلدية والعناية بالبشرة.',
  color: '#f3e8d7',
  image: 'doctor-4.jpg',
  verified: true,
  license: 'SY-MD-12043',
};

function attribute(markup: string, name: string) {
  return markup.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1].replaceAll('&amp;', '&');
}

describe('Public doctor portrait rendering', () => {
  it.each([
    ['doctor-4.jpg', '/images/doctor-4.webp'],
    ['doctor-5.jpg', '/images/doctor-5.webp'],
    ['doctor-6.jpg', '/images/doctor-6.webp'],
    ['doctor-samir.jpg', '/images/doctor-samir.webp'],
  ])('renders %s as a responsive, accessible portrait below 150 KB', async (original, source) => {
    const markup = renderToStaticMarkup(
      createElement(DoctorCard, { doctor: { ...doctor, image: original } }),
    );
    const image = markup.match(/<img\b[^>]*>/)?.[0];
    expect(image).toBeDefined();
    if (!image) throw new Error('The doctor card did not render a portrait');

    const url = new URL(attribute(image, 'src') ?? '', 'http://localhost');
    expect(url.pathname).toBe('/_next/image');
    expect(url.searchParams.get('url')).toBe(source);
    expect(attribute(image, 'alt')).toBe('د. رنا الشامي');
    expect(attribute(image, 'width')).toBe('300');
    expect(attribute(image, 'height')).toBe('205');
    expect(attribute(image, 'loading')).toBe('lazy');
    expect(attribute(image, 'sizes')).toMatch(/max-width/);
    expect(attribute(image, 'srcSet') ?? attribute(image, 'srcset')).toMatch(/\d+w.*\d+w/);

    const bytes = await readFile(new URL(`../../public${source}`, import.meta.url));
    const metadata = await sharp(bytes).metadata();
    expect(bytes.byteLength).toBeLessThan(150_000);
    expect(metadata.format).toBe('webp');
    expect((metadata.width ?? 0) / (metadata.height ?? 1)).toBeCloseTo(896 / 1200, 3);
  });
});
