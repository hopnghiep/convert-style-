
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { stylizeImage, generateImageFromPrompt, animateImage, upscaleImage, RateLimitError } from './services/geminiService';
import { ART_STYLES, DEFAULT_FOLDERS } from './constants';
import type { ArtStyle, Preset, ImageEditorAdjustments, StyleFolder, GalleryImage } from './types';
import ImageUploader from './components/ImageUploader';
import StyleSelector from './components/StyleSelector';
import ResultDisplay from './components/ResultDisplay';
import { LoadingSpinner } from './components/LoadingSpinner';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import StyleInfluenceSlider from './components/StyleInfluenceSlider';
import DistortionSlider from './components/DistortionSlider';
import StyleReferenceUploader from './components/StyleReferenceUploader';
import ColorAdjustmentSliders from './components/ColorAdjustmentSliders';
import AspectRatioSelector from './components/AspectRatioSelector';
import CustomStyleInput from './components/CustomStyleInput';
import StylePresets from './components/StylePresets';
import ImageCropperModal from './components/ImageCropperModal';
import StylePreviewModal from './components/StylePreviewModal';
import DeletedStyles from './components/DeletedStyles';
import StyleSearch from './components/StyleSearch';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import BlendSlider from './components/BlendSlider';
import FolderManager from './components/FolderManager';
import ImageGallery from './components/ImageGallery';
import SaveStyleModal from './components/SaveStyleModal';
import EditStyleModal from './components/EditStyleModal';

// Declare window types for aistudio
declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }
  interface Window {
    aistudio?: AIStudio;
  }
}

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@4.4.168/build/pdf.worker.mjs`;

interface ImageState {
  id: string;
  name: string;
  originalData: string;
  originalType: string;
  history: string[];
  historyIndex: number;
  animatedVideoUrl: string | null;
  adjustments: ImageEditorAdjustments;
  adjustmentHistory: ImageEditorAdjustments[];
  adjustmentHistoryIndex: number;
}

const initialAdjustmentsState: ImageEditorAdjustments = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
};

function App() {
  const [images, setImages] = useState<ImageState[]>([]);
  const [galleryImages, setGalleryImages] = useState<GalleryImage[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [isOriginalImageLoading, setIsOriginalImageLoading] = useState<boolean>(false);
  const [selectedStyle, setSelectedStyle] = useState<ArtStyle | null>(null);
  const [customStylePrompt, setCustomStylePrompt] = useState<string>('');
  const [styleReferenceImage, setStyleReferenceImage] = useState<string | null>(null);
  const [isStyleReferenceLoading, setIsStyleReferenceLoading] = useState<boolean>(false);
  const [styleInfluence, setStyleInfluence] = useState<number>(70);
  const [vibrancy, setVibrancy] = useState<number>(0);
  const [mood, setMood] = useState<number>(0);
  const [aspectRatio, setAspectRatio] = useState<string>('auto');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isPreviewing, setIsPreviewing] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [isAnimating, setIsAnimating] = useState<boolean>(false);
  const [isUpscaling, setIsUpscaling] = useState<boolean>(false);
  const [editPrompt, setEditPrompt] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [rateLimitCooldown, setRateLimitCooldown] = useState<number>(0);
  const [croppingTarget, setCroppingTarget] = useState<{ id: string, type: 'original' | 'generated' } | null>(null);
  const [previewingStyle, setPreviewingStyle] = useState<ArtStyle | null>(null);
  const [editingStyle, setEditingStyle] = useState<ArtStyle | null>(null);
  const [artStyles, setArtStyles] = useState<ArtStyle[]>([]);
  const [progress, setProgress] = useState<number>(0);
  const progressIntervalRef = useRef<number | null>(null);
  const [styleSearchTerm, setStyleSearchTerm] = useState<string>('');
  const [isParsingFile, setIsParsingFile] = useState<boolean>(false);
  const [editReferenceImages, setEditReferenceImages] = useState<{ data: string, type: string }[]>([]);
  const [isEditReferenceLoading, setIsEditReferenceLoading] = useState<boolean>(false);
  const [language, setLanguage] = useState<'vi' | 'en'>('vi');
  const [isBatchMode, setIsBatchMode] = useState<boolean>(false);
  const [isBlendMode, setIsBlendMode] = useState<boolean>(false);
  const [blendStyleA, setBlendStyleA] = useState<ArtStyle | null>(null);
  const [blendStyleB, setBlendStyleB] = useState<ArtStyle | null>(null);
  const [styleFolders, setStyleFolders] = useState<StyleFolder[]>([]);
  const [lastGenUsedRef, setLastGenUsedRef] = useState<boolean>(false);
  const [batchSelectedIds, setBatchSelectedIds] = useState<Set<string>>(new Set());
  const [openStyleFolderId, setOpenStyleFolderId] = useState<string | 'uncategorized' | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);

  // State for batch processing
  const [isBatchProcessing, setIsBatchProcessing] = useState<boolean>(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [batchResults, setBatchResults] = useState<{ styleId: string; imageUrl: string | null; error?: string }[]>([]);

  const selectedImage = useMemo(() => images.find(img => img.id === selectedImageId), [images, selectedImageId]);
  const originalImage = useMemo(() => selectedImage?.originalData ?? null, [selectedImage]);
  const generatedImage = useMemo(() => selectedImage?.history[selectedImage.historyIndex] ?? null, [selectedImage]);
  const animatedVideoUrl = useMemo(() => selectedImage?.animatedVideoUrl ?? null, [selectedImage]);
  const adjustments = useMemo(() => selectedImage?.adjustments ?? initialAdjustmentsState, [selectedImage]);

  const canUndo = (selectedImage?.historyIndex ?? 0) > 0;
  const actualCanRedo = selectedImage ? selectedImage.historyIndex < selectedImage.history.length - 1 : false;
  const canUndoAdjustment = selectedImage ? selectedImage.adjustmentHistoryIndex > 0 : false;
  const canRedoAdjustment = selectedImage ? selectedImage.adjustmentHistoryIndex < selectedImage.adjustmentHistory.length - 1 : false;

  const updateImage = useCallback((id: string, updater: (image: ImageState) => ImageState) => {
    setImages(prevImages => prevImages.map(img => (img.id === id ? updater(img) : img)));
  }, []);

  useEffect(() => {
    try {
      setPresets(JSON.parse(localStorage.getItem('stylePresets') || '[]'));
      setGalleryImages(JSON.parse(localStorage.getItem('imageGallery') || '[]'));
      const savedFolders = JSON.parse(localStorage.getItem('styleFolders') || 'null') || DEFAULT_FOLDERS;
      setStyleFolders(savedFolders);
      const savedStyles = JSON.parse(localStorage.getItem('artStyles') || '[]');
      const reconciledStyles = ART_STYLES.map(s => {
        const saved = savedStyles.find((ss: any) => ss.id === s.id);
        return saved ? { ...s, isDeleted: !!saved.isDeleted, rating: saved.rating || 0, folderId: saved.folderId ?? s.folderId, referenceImage: saved.referenceImage, label_vi: saved.label_vi || s.label_vi, prompt_vi: saved.prompt_vi || s.prompt_vi, label: saved.label || s.label, prompt: saved.prompt || s.prompt } : { ...s, isDeleted: false, rating: 0 };
      });
      const userStyles = savedStyles.filter((ss: any) => !ART_STYLES.find(s => s.id === ss.id));
      setArtStyles([...reconciledStyles, ...userStyles]);
      const savedLang = localStorage.getItem('appLanguage') as 'vi' | 'en';
      if (savedLang) setLanguage(savedLang);
    } catch (e) {
      console.error(e);
      setArtStyles(ART_STYLES.map(s => ({ ...s, isDeleted: false, rating: 0 })));
    }
  }, []);

  useEffect(() => {
    if (artStyles.length > 0) {
      localStorage.setItem('stylePresets', JSON.stringify(presets));
      localStorage.setItem('artStyles', JSON.stringify(artStyles));
      localStorage.setItem('styleFolders', JSON.stringify(styleFolders));
      localStorage.setItem('imageGallery', JSON.stringify(galleryImages));
      localStorage.setItem('appLanguage', language);
    }
  }, [presets, artStyles, styleFolders, galleryImages, language]);

  const startProgressSimulation = () => {
    setProgress(0);
    progressIntervalRef.current = window.setInterval(() => {
      setProgress(p => (p >= 95 ? 95 : p + Math.random() * 5));
    }, 400);
  };

  const stopProgressSimulation = () => {
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    setProgress(100);
    setTimeout(() => setProgress(0), 500);
  };

  const handleImageUpload = useCallback((files: File[]) => {
    setIsOriginalImageLoading(true);
    let loadedCount = 0;
    const loadedImages: ImageState[] = [];
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        const newId = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        loadedImages.push({
          id: newId, name: file.name, originalData: dataUrl, originalType: file.type, history: [dataUrl], historyIndex: 0,
          animatedVideoUrl: null, adjustments: { ...initialAdjustmentsState }, adjustmentHistory: [{ ...initialAdjustmentsState }], adjustmentHistoryIndex: 0,
        });
        loadedCount++;
        if (loadedCount === files.length) {
          setImages(prev => [...prev, ...loadedImages]);
          setSelectedImageId(loadedImages[0].id);
          setIsOriginalImageLoading(false);
        }
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const addToGallery = useCallback((url: string, styleName: string, prompt: string) => {
    const newEntry: GalleryImage = { id: `gallery_${Date.now()}`, url, styleName, prompt, timestamp: Date.now(), aspectRatio: aspectRatio === 'auto' ? '1:1' : aspectRatio };
    setGalleryImages(prev => [newEntry, ...prev]);
  }, [aspectRatio]);

  const addImageToHistory = useCallback((newImageSrc: string) => {
    if (!selectedImageId) return;
    updateImage(selectedImageId, img => {
      const truncatedHistory = img.history.slice(0, img.historyIndex + 1);
      const newHistory = [...truncatedHistory, newImageSrc];
      return { ...img, history: newHistory, historyIndex: newHistory.length - 1, animatedVideoUrl: null, adjustments: initialAdjustmentsState, adjustmentHistory: [initialAdjustmentsState], adjustmentHistoryIndex: 0 };
    });
  }, [selectedImageId, updateImage]);

  // Helper to enhance prompt with vibrancy and mood
  const getEnhancedPrompt = (basePrompt: string) => {
    let enhanced = basePrompt;
    if (vibrancy > 20) enhanced += " High vibrancy, saturated colors, vivid details.";
    else if (vibrancy < -20) enhanced += " Muted tones, desaturated palette, soft colors.";
    
    if (mood > 20) enhanced += " Bright lighting, airy atmosphere, optimistic feel.";
    else if (mood < -20) enhanced += " Dark moody lighting, cinematic shadows, dramatic atmosphere.";
    
    return enhanced;
  };

  const handleGenerateClick = async () => {
    if (!originalImage || !selectedImage || (!selectedStyle && !customStylePrompt.trim())) return;
    setIsLoading(true); setError(null); startProgressSimulation();
    try {
      const base64Data = selectedImage.originalData.split(',')[1];
      
      let basePrompt = '';
      if (selectedStyle) {
        const stylePrompt = language === 'vi' ? (selectedStyle.prompt_vi || selectedStyle.prompt) : selectedStyle.prompt;
        // Combine style prompt with user's custom text if present
        basePrompt = customStylePrompt.trim() 
          ? `${stylePrompt}. Also, follow these extra instructions: ${customStylePrompt.trim()}`
          : stylePrompt;
      } else {
        basePrompt = customStylePrompt;
      }
      
      const enhancedPrompt = getEnhancedPrompt(basePrompt);
      
      const refImageBase64 = selectedStyle?.referenceImage ? selectedStyle.referenceImage.split(',')[1] : null;
      const refImageType = selectedStyle?.referenceImage ? selectedStyle.referenceImage.substring(5, selectedStyle.referenceImage.indexOf(';')) : null;

      const res = await stylizeImage(base64Data, selectedImage.originalType, enhancedPrompt, refImageBase64, refImageType, selectedStyle?.id, aspectRatio);
      if (res) {
        const fullRes = `data:image/png;base64,${res}`;
        addImageToHistory(fullRes);
        const displayName = selectedStyle 
          ? (language === 'vi' ? (selectedStyle.label_vi || selectedStyle.label) : selectedStyle.label)
          : (language === 'vi' ? 'Mô tả tùy chỉnh' : 'Custom Description');
        addToGallery(fullRes, displayName, enhancedPrompt);
        setLastGenUsedRef(false); 
      }
    } catch (err: any) { setError(err.message); }
    finally { setIsLoading(false); stopProgressSimulation(); }
  };

  const handleBatchGenerateClick = async () => {
    if (!originalImage || !selectedImage || batchSelectedIds.size === 0) return;
    
    setIsBatchProcessing(true);
    setBatchResults([]);
    setError(null);
    const selectedIds = Array.from(batchSelectedIds);
    const total = selectedIds.length;
    
    const results: { styleId: string; imageUrl: string | null; error?: string }[] = [];
    
    for (let i = 0; i < total; i++) {
      const styleId = selectedIds[i] as string;
      const style = artStyles.find(s => s.id === styleId);
      if (!style) continue;

      setBatchProgress({ current: i + 1, total });
      
      try {
        const base64Data = selectedImage.originalData.split(',')[1];
        const stylePrompt = language === 'vi' ? (style.prompt_vi || style.prompt) : style.prompt;
        
        // Include custom prompt as a global modifier for the batch
        const basePrompt = customStylePrompt.trim() 
            ? `${stylePrompt}. Extra detail: ${customStylePrompt.trim()}`
            : stylePrompt;

        const enhancedPrompt = getEnhancedPrompt(basePrompt);
        
        const refImageBase64 = style.referenceImage ? style.referenceImage.split(',')[1] : null;
        const refImageType = style.referenceImage ? style.referenceImage.substring(5, style.referenceImage.indexOf(';')) : null;

        const res = await stylizeImage(base64Data, selectedImage.originalType, enhancedPrompt, refImageBase64, refImageType, style.id, aspectRatio);
        if (res) {
          const fullRes = `data:image/png;base64,${res}`;
          results.push({ styleId: styleId, imageUrl: fullRes });
          const displayName = language === 'vi' ? (style.label_vi || style.label) : style.label;
          addToGallery(fullRes, displayName, enhancedPrompt);
        } else {
          results.push({ styleId: styleId, imageUrl: null, error: 'AI không phản hồi kết quả.' });
        }
      } catch (err: any) {
        results.push({ styleId: styleId, imageUrl: null, error: (err as any)?.message || String(err) });
      }
    }
    
    setBatchResults(results);
    setIsBatchProcessing(false);
    setBatchProgress(null);
  };

  const handleCreateNewImage = async () => {
    if (!customStylePrompt.trim() && !styleReferenceImage) return;
    
    // Check for API key before calling advanced generation models
    if (window.aistudio) {
      const hasKey = await window.aistudio.hasSelectedApiKey();
      if (!hasKey) {
        await window.aistudio.openSelectKey();
        return;
      }
    }

    setIsLoading(true); setError(null); startProgressSimulation();
    try {
      const enhancedPrompt = getEnhancedPrompt(customStylePrompt.trim() || 'A beautiful artistic generation');
      
      let res: string | null = null;
      if (styleReferenceImage && selectedImage) {
        // If there is an original image and a style reference, perform style transfer
        const base64Content = selectedImage.originalData.split(',')[1];
        const mimeType = selectedImage.originalType;
        const base64Ref = styleReferenceImage.split(',')[1];
        const refMime = styleReferenceImage.substring(5, styleReferenceImage.indexOf(';'));
        const smartPrompt = `STRICTLY apply the visual artistic style from the SECOND image to the content of the FIRST image. Prompt: ${enhancedPrompt}`;
        res = await stylizeImage(base64Content, mimeType, smartPrompt, base64Ref, refMime, undefined, aspectRatio);
        setLastGenUsedRef(true); 
      } else {
        // Pure Text-to-Image generation using Imagen 4
        res = await generateImageFromPrompt(enhancedPrompt, aspectRatio);
        setLastGenUsedRef(false);
      }

      if (res) {
        const fullRes = `data:image/png;base64,${res}`;
        if (selectedImageId) {
          addImageToHistory(fullRes);
        } else {
          const newId = `gen_${Date.now()}`;
          setImages(prev => [{
            id: newId, name: 'AI Generated', originalData: fullRes, originalType: 'image/png', history: [fullRes], historyIndex: 0,
            animatedVideoUrl: null, adjustments: { ...initialAdjustmentsState }, adjustmentHistory: [{ ...initialAdjustmentsState }], adjustmentHistoryIndex: 0,
          }, ...prev]);
          setSelectedImageId(newId);
        }
        addToGallery(fullRes, language === 'vi' ? 'Tạo mới từ AI' : 'New AI Generation', enhancedPrompt);
      }
    } catch (err: any) { 
      if (err.message?.includes("Requested entity was not found.")) window.aistudio?.openSelectKey();
      setError(err.message); 
    }
    finally { setIsLoading(false); stopProgressSimulation(); }
  };

  const handleSavePreset = (name: string) => {
    const newPreset: Preset = {
      id: `preset_${Date.now()}`,
      name,
      styleId: selectedStyle?.id || null,
      customStylePrompt,
      styleInfluence,
      vibrancy,
      mood,
      aspectRatio,
    };
    setPresets(prev => [...prev, newPreset]);
  };

  const handleApplyPreset = (preset: Preset) => {
    if (preset.styleId) {
      const style = artStyles.find(s => s.id === preset.styleId);
      if (style) setSelectedStyle(style);
    } else {
      setSelectedStyle(null);
    }
    setCustomStylePrompt(preset.customStylePrompt);
    setStyleInfluence(preset.styleInfluence);
    setVibrancy(preset.vibrancy);
    setMood(preset.mood);
    setAspectRatio(preset.aspectRatio);
  };

  const handleDeletePreset = (id: string) => {
    setPresets(prev => prev.filter(p => p.id !== id));
  };

  const handleSaveStyleConfirm = (name: string, folderId: string | null) => {
    if (!styleReferenceImage) return;
    const newStyle: ArtStyle = {
      id: `custom_style_${Date.now()}`,
      label: name, label_vi: name,
      prompt: customStylePrompt || "Apply this unique visual aesthetic.",
      thumbnail: styleReferenceImage, preview: styleReferenceImage, exampleImage: styleReferenceImage, referenceImage: styleReferenceImage,
      folderId: folderId, rating: 0, isDeleted: false
    };
    setArtStyles(prev => [...prev, newStyle]);
    setSelectedStyle(newStyle);
    setOpenStyleFolderId(folderId || 'uncategorized'); 
    alert(language === 'vi' ? 'Lưu thành công!' : 'Saved successfully!');
    setLastGenUsedRef(false); 
  };

  const handleUpdateStyleConfirm = (id: string, name: string, prompt: string) => {
    setArtStyles(prev => prev.map(s => s.id === id ? (language === 'vi' ? { ...s, label_vi: name, prompt_vi: prompt } : { ...s, label: name, prompt: prompt }) : s));
    alert(language === 'vi' ? "Đã cập nhật!" : "Updated!");
  };

  const handleUpscale = async (size: '2K' | '4K') => {
    if (!generatedImage || !selectedImage) return;
    setIsUpscaling(true); setError(null); startProgressSimulation();
    try {
      const base64Data = generatedImage.split(',')[1];
      const res = await upscaleImage(base64Data, 'image/png', size);
      if (res) addImageToHistory(`data:image/png;base64,${res}`);
    } catch (err: any) { setError(err.message); }
    finally { setIsUpscaling(false); stopProgressSimulation(); }
  };

  const handleAnimate = useCallback(async () => {
    if (!generatedImage || !selectedImage) return;
    setIsAnimating(true); setError(null);
    try {
      const base64Data = generatedImage.split(',')[1];
      const videoUrl = await animateImage(base64Data, 'image/png');
      if (videoUrl) updateImage(selectedImage.id, img => ({ ...img, animatedVideoUrl: videoUrl }));
    } catch (err: any) { setError(err.message); } 
    finally { setIsAnimating(false); }
  }, [generatedImage, selectedImage, updateImage]);

  const visibleArtStyles = useMemo(() => {
    return artStyles.filter(s => {
      const matchesSearch = s.label.toLowerCase().includes(styleSearchTerm.toLowerCase()) || (s.label_vi && s.label_vi.toLowerCase().includes(styleSearchTerm.toLowerCase()));
      return !s.isDeleted && matchesSearch;
    });
  }, [artStyles, styleSearchTerm]);

  return (
    <div className="min-h-screen bg-[#f8f5f2] text-[#423a3a] flex flex-col font-sans">
      <Header language={language} onLanguageChange={setLanguage} />
      <main className="flex-grow w-full px-2 md:px-6 py-6 space-y-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-3 space-y-6">
            <section className="bg-white/90 p-6 rounded-2xl shadow-lg border border-gray-200">
              <h2 className="text-xl font-bold mb-4 text-[#4A6B5D] uppercase tracking-wide">1. {language === 'vi' ? 'Tải ảnh & Thao tác' : 'Upload & Actions'}</h2>
              <ImageUploader 
                onImageUpload={handleImageUpload} 
                images={images.map(i => ({ id: i.id, name: i.name, data: i.originalData }))}
                selectedImageId={selectedImageId} onSelectImage={setSelectedImageId} onRemoveImage={id => setImages(prev => prev.filter(img => img.id !== id))}
                onClearAll={() => setImages([])} onCropClick={id => setCroppingTarget({ id, type: 'original' })} isLoading={isOriginalImageLoading} language={language}
              />
              
              <button 
                onClick={isBatchMode ? handleBatchGenerateClick : handleGenerateClick} 
                disabled={isLoading || isBatchProcessing || (!originalImage && !isBatchMode) || (isBatchMode ? (batchSelectedIds.size === 0) : (!selectedStyle && !customStylePrompt.trim()))} 
                className="w-full py-4 mt-6 bg-[#4A6B5D] text-white rounded-xl font-bold shadow-xl hover:shadow-2xl transition-all disabled:opacity-50"
              >
                {(isLoading || isBatchProcessing) ? (
                  <LoadingSpinner />
                ) : (
                  isBatchMode 
                    ? (language === 'vi' ? `Tạo ảnh hàng loạt (${batchSelectedIds.size})` : `Batch Create Images (${batchSelectedIds.size})`)
                    : (language === 'vi' ? "Chuyển đổi ngay" : "Convert Now")
                )}
              </button>

              {error && <p className="mt-4 p-3 bg-red-100 text-red-800 rounded-lg text-sm font-bold">{error}</p>}
            </section>

            <section className="bg-white/90 p-6 rounded-2xl shadow-lg border border-gray-200">
                <h2 className="text-xl font-bold mb-4 text-[#4A6B5D] uppercase tracking-wide">{language === 'vi' ? 'Thiết lập bổ sung' : 'Extra Settings'}</h2>
                <ColorAdjustmentSliders vibrancy={vibrancy} onVibrancyChange={setVibrancy} mood={mood} onMoodChange={setMood} language={language} />
                <AspectRatioSelector selectedValue={aspectRatio} onChange={setAspectRatio} language={language} />
            </section>

            <section className="bg-white/90 p-6 rounded-2xl shadow-lg border border-gray-200">
                <StylePresets 
                    presets={presets} 
                    onSave={handleSavePreset} 
                    onApply={handleApplyPreset} 
                    onDelete={handleDeletePreset} 
                    isSaveEnabled={!!(selectedStyle || customStylePrompt.trim())} 
                    styles={artStyles}
                    language={language}
                />
            </section>

            <section className="bg-white/90 p-6 rounded-2xl shadow-lg border border-gray-200">
                <h2 className="text-xl font-bold mb-4 text-[#4A6B5D] uppercase tracking-wide">4. Style Influence</h2>
                <StyleInfluenceSlider value={styleInfluence} onChange={setStyleInfluence} language={language} />
            </section>
          </div>

          <div className="lg:col-span-4">
             <section className="bg-white/90 p-6 rounded-2xl shadow-lg border border-gray-200 h-full flex flex-col overflow-y-auto max-h-[calc(100vh-160px)] custom-scrollbar">
                <h2 className="text-xl font-bold mb-4 text-[#4A6B5D] uppercase tracking-wide">2. {language === 'vi' ? 'Chọn hoặc mô tả phong cách' : 'Select or describe style'}</h2>
                
                <div className="flex items-center gap-6 mb-4">
                  <label className="flex items-center cursor-pointer group">
                    <div className="relative">
                      <input type="checkbox" className="sr-only" checked={isBatchMode} onChange={() => {setIsBatchMode(!isBatchMode); setIsBlendMode(false)}} />
                      <div className={`block w-10 h-5 rounded-full transition-colors ${isBatchMode ? 'bg-[#4A6B5D]' : 'bg-gray-300'}`}></div>
                      <div className={`absolute left-0.5 top-0.5 bg-white w-4 h-4 rounded-full transition-transform ${isBatchMode ? 'translate-x-5' : ''}`}></div>
                    </div>
                    <div className="ml-2 text-[#423a3a] text-sm font-bold">{language === 'vi' ? 'Hàng loạt' : 'Batch'}</div>
                  </label>
                  <label className="flex items-center cursor-pointer group">
                    <div className="relative">
                      <input type="checkbox" className="sr-only" checked={isBlendMode} onChange={() => {setIsBlendMode(!isBlendMode); setIsBatchMode(false)}} />
                      <div className={`block w-10 h-5 rounded-full transition-colors ${isBlendMode ? 'bg-[#4A6B5D]' : 'bg-gray-300'}`}></div>
                      <div className={`absolute left-0.5 top-0.5 bg-white w-4 h-4 rounded-full transition-transform ${isBlendMode ? 'translate-x-5' : ''}`}></div>
                    </div>
                    <div className="ml-2 text-[#423a3a] text-sm font-bold">{language === 'vi' ? 'Hòa trộn' : 'Blend'}</div>
                  </label>
                </div>

                <StyleSearch value={styleSearchTerm} onChange={setStyleSearchTerm} placeholder={language === 'vi' ? "Tìm kiếm..." : "Search..."} />
                
                {isBatchMode && (
                  <div className="flex items-center gap-2 mb-4 animate-fade-in px-1">
                    <input type="checkbox" id="selectAllBatch" checked={batchSelectedIds.size === visibleArtStyles.length && visibleArtStyles.length > 0} onChange={(e) => e.target.checked ? setBatchSelectedIds(new Set(visibleArtStyles.map(s => s.id))) : setBatchSelectedIds(new Set())} className="w-4 h-4 rounded border-gray-300 text-[#4A6B5D] focus:ring-[#4A6B5D] cursor-pointer" />
                    <label htmlFor="selectAllBatch" className="text-sm font-bold text-gray-700 cursor-pointer">{language === 'vi' ? `Chọn tất cả (${batchSelectedIds.size})` : `Select all (${batchSelectedIds.size})`}</label>
                  </div>
                )}

                <FolderManager folders={styleFolders} onCreateFolder={(n) => setStyleFolders([...styleFolders, {id: `fld_${Date.now()}`, name: n}])} onDeleteFolder={(id) => setStyleFolders(styleFolders.filter(f => f.id !== id))} onRenameFolder={(id, n) => setStyleFolders(styleFolders.map(f => f.id === id ? {...f, name: n} : f))} language={language} />
                
                <StyleSelector 
                  styles={visibleArtStyles} selectedStyle={selectedStyle} styleFolders={styleFolders}
                  onStyleSelect={setSelectedStyle} onStylePreview={setPreviewingStyle} 
                  onStyleDelete={id => setArtStyles(prev => prev.map(s => s.id === id ? {...s, isDeleted: true} : s))}
                  onStyleEdit={setEditingStyle} onSetRating={(id, r) => setArtStyles(prev => prev.map(s => s.id === id ? {...s, rating: r} : s))}
                  onMoveStyleToFolder={(sId, fId) => setArtStyles(prev => prev.map(s => s.id === sId ? {...s, folderId: fId} : s))}
                  onSelectAll={() => {}} onDeselectAll={() => {}} 
                  isBatchMode={isBatchMode} batchSelectedIds={batchSelectedIds} onBatchStyleToggle={(id) => {
                    const next = new Set(batchSelectedIds);
                    if (next.has(id)) next.delete(id); else next.add(id);
                    setBatchSelectedIds(next);
                  }}
                  isBlendMode={isBlendMode} blendStyleA={blendStyleA} blendStyleB={blendStyleB} onBlendStyleSelect={(s) => {
                    if (!blendStyleA) setBlendStyleA(s); else if (blendStyleA.id === s.id) setBlendStyleA(null); else setBlendStyleB(s);
                  }}
                  language={language} externalOpenFolderId={openStyleFolderId} onFolderToggle={setOpenStyleFolderId}
                />
                <div className="mt-8 space-y-6">
                    <CustomStyleInput 
                      value={customStylePrompt} 
                      onChange={setCustomStylePrompt} 
                      language={language} 
                      isModifierMode={!!selectedStyle}
                    />
                    <div className="relative flex items-center"><div className="flex-grow border-t border-gray-200"></div><span className="flex-shrink mx-4 text-gray-400 font-bold text-sm tracking-widest uppercase">Hoặc</span><div className="flex-grow border-t border-gray-200"></div></div>
                    <div className="space-y-4">
                        <StyleReferenceUploader styleReferenceImage={styleReferenceImage} onImageUpload={(f) => { const r = new FileReader(); r.onload = (e) => setStyleReferenceImage(e.target?.result as string); r.readAsDataURL(f); }} onImageClear={() => { setStyleReferenceImage(null); setLastGenUsedRef(false); }} isLoading={isStyleReferenceLoading} language={language} />
                        <button onClick={handleCreateNewImage} disabled={isLoading || (!customStylePrompt.trim() && !styleReferenceImage)} className="w-full py-4 bg-[#A98768] text-white rounded-xl font-bold shadow-lg hover:shadow-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2 border-b-4 border-[#8b6f54] active:border-b-0 active:translate-y-1">
                            {isLoading ? <LoadingSpinner /> : <><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>{language === 'vi' ? 'Tạo ảnh mới' : 'Create New Image'}</>}
                        </button>
                        {lastGenUsedRef && styleReferenceImage && !isLoading && (
                          <button onClick={() => setShowSaveModal(true)} className="w-full py-3 bg-[#ecf3f0] text-[#4a6b5d] border border-[#4a6b5d] rounded-xl font-bold shadow-sm hover:bg-[#dfebe6] transition-all flex items-center justify-center gap-2 animate-in fade-in slide-in-from-bottom-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                            {language === 'vi' ? 'Lưu thành phong cách của tôi' : 'Save to My Styles'}
                          </button>
                        )}
                    </div>
                </div>
             </section>
          </div>

          <div className="lg:col-span-5">
             <section className="bg-white/40 p-4 rounded-2xl shadow-inner min-h-[600px] border border-gray-100 h-full">
               <ResultDisplay 
                 originalImage={originalImage} generatedImage={generatedImage} styleReferenceImage={styleReferenceImage} selectedStyle={selectedStyle} customStylePrompt={customStylePrompt}
                 isLoading={isLoading} progress={progress} adjustments={adjustments} onAdjustmentChange={(k, v) => updateImage(selectedImageId!, img => ({...img, adjustments: {...img.adjustments, [k]: v}}))}
                 isPreviewing={isPreviewing} animatedVideoUrl={animatedVideoUrl} isAnimating={isAnimating} onAnimate={handleAnimate} isEditing={isEditing} editPrompt={editPrompt} onEditPromptChange={setEditPrompt}
                 onEditTextFileUpload={() => {}} onEdit={() => {}} onCrop={() => setCroppingTarget({id: selectedImageId!, type: 'generated'})} onUndo={canUndo ? () => updateImage(selectedImageId!, img => ({...img, historyIndex: img.historyIndex - 1})) : () => {}} onRedo={actualCanRedo ? () => updateImage(selectedImageId!, img => ({...img, historyIndex: img.historyIndex + 1})) : () => {}} canUndo={canUndo} canRedo={actualCanRedo} isUpscaling={isUpscaling} onUpscale={handleUpscale}
                 rateLimitCooldown={rateLimitCooldown} onCommitSliderAdjustments={() => {}} onRotate={() => {}} onFlip={() => {}} onResetAdjustments={() => {}} onUndoAdjustment={() => {}} onRedoAdjustment={() => {}}
                 canUndoAdjustment={canUndoAdjustment} canRedoAdjustment={canRedoAdjustment} isBatchMode={isBatchMode} isBatchProcessing={isBatchProcessing} batchProgress={batchProgress} batchResults={batchResults}
                 allArtStyles={artStyles} onClearBatchResults={() => { setBatchResults([]); }} isParsingFile={isParsingFile} editReferenceImages={editReferenceImages} isEditReferenceLoading={isEditReferenceLoading} onEditReferenceImageUpload={() => {}}
                 onClearEditReferenceImage={() => {}} language={language}
               />
             </section>
          </div>
        </div>
        <ImageGallery images={galleryImages} onRemoveImage={(id) => setGalleryImages(prev => prev.filter(img => img.id !== id))} onClearAll={() => { if(window.confirm(language === 'vi' ? 'Xóa toàn bộ thư viện ảnh đã tạo?' : 'Delete all generated gallery images?')) setGalleryImages([]); }} language={language} />
      </main>
      <Footer />
      {croppingTarget && <ImageCropperModal imageUrl={croppingTarget.type === 'original' ? images.find(img => img.id === croppingTarget.id)!.originalData : images.find(img => img.id === croppingTarget.id)!.history[images.find(img => img.id === croppingTarget.id)!.historyIndex]} aspectRatio={aspectRatio} onCancel={() => setCroppingTarget(null)} onCropComplete={(url) => { if (croppingTarget.type === 'original') { updateImage(croppingTarget.id, img => ({...img, originalData: url, history: [url], historyIndex: 0})); } else { addImageToHistory(url); } setCroppingTarget(null); }} />}
      {previewingStyle && <StylePreviewModal style={previewingStyle} onClose={() => setPreviewingStyle(null)} onPreviewGenerated={(id, url) => setArtStyles(prev => prev.map(s => s.id === id ? {...s, preview: url} : s))} />}
      {showSaveModal && <SaveStyleModal folders={styleFolders} onClose={() => setShowSaveModal(false)} onSave={handleSaveStyleConfirm} language={language} />}
      {editingStyle && <EditStyleModal style={editingStyle} onClose={() => setEditingStyle(null)} onSave={handleUpdateStyleConfirm} language={language} />}
    </div>
  );
}

export default App;
