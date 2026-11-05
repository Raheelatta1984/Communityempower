import React from 'react';
import { ShieldCheck } from 'lucide-react';

// A single failing panel should never leave the whole portal blank. Sections are
// wrapped individually so navigation keeps working and the error is visible.
export class SectionBoundary extends React.Component{
  constructor(props){super(props);this.state={error:null}}
  static getDerivedStateFromError(error){return {error}}
  componentDidUpdate(prevProps){if(prevProps.resetKey!==this.props.resetKey&&this.state.error)this.setState({error:null})}
  render(){
    if(this.state.error){
      return <div className="section-error panel">
        <ShieldCheck size={20}/>
        <div><b>This section could not load</b><p>{String(this.state.error.message||this.state.error)}</p>
        <small>Your data is safe. Try another tab, or reload the section.</small></div>
        <button className="primary-button" onClick={()=>{this.setState({error:null});this.props.onRecover?.()}}>Try again</button>
      </div>
    }
    return this.props.children
  }
}

