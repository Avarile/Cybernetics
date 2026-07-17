"use client";

import {
    AudioPlayer,
    AudioPlayerControlBar,
    AudioPlayerElement,
    AudioPlayerMuteButton,
    AudioPlayerPlayButton,
    AudioPlayerTimeDisplay,
    AudioPlayerTimeRange,
} from "@/components/ai-elements/voice/audio-player";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue,} from "@/components/ui/select";
import {useState} from "react";

const tracks = [
  { name: "Abaddon", src: "/music/Abaddon.mp3" },
  { name: "Silent Street", src: "/music/Silent-Street.mp3" },
  { name: "Phantom Liberty", src: "/music/Phantom-liberty.mp3" },
]

interface MusicPlayerProps {
    onPlayingChange?: (playing: boolean) => void;
    showPersona?: boolean;
}

const MusicPlayer = ({onPlayingChange, showPersona}: MusicPlayerProps) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);

    const handlePlay = () => {
        setIsPlaying(true);
        onPlayingChange?.(true);
    };

    const handlePause = () => {
        setIsPlaying(false);
        onPlayingChange?.(false);
    };

    const handleTrackSelect = (value: string) => {
        const index = Number(value);
        if (index === selectedIndex) return;
        setSelectedIndex(index);
        setIsPlaying(false);
        onPlayingChange?.(false);
    };

    return (
        <div className="flex w-full flex-col gap-3 p-3">
            <Select value={String(selectedIndex)} onValueChange={handleTrackSelect}>
                <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a track"/>
                </SelectTrigger>
                <SelectContent>
                    {tracks.map((track, i) => (
                        <SelectItem key={track.src} value={String(i)}>
                            {track.name}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <AudioPlayer className="w-full" key={selectedIndex}>
                <AudioPlayerElement
                    src={tracks[selectedIndex].src}
                    onPlay={handlePlay}
                    onPause={handlePause}
                    onEnded={handlePause}
                />
                <AudioPlayerControlBar>
                    <AudioPlayerPlayButton/>
                    <AudioPlayerTimeDisplay/>
                    <AudioPlayerTimeRange/>
                    <AudioPlayerMuteButton/>
                </AudioPlayerControlBar>
            </AudioPlayer>
        </div>
    );
};

export default MusicPlayer;
