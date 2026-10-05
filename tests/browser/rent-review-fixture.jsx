import React from 'react';
import {createRoot} from 'react-dom/client';
import {RentReviewWorkspace} from '../../src/components/rent-review-workspace';
createRoot(document.getElementById('root')).render(<main style={{padding:20}}><RentReviewWorkspace facilities={[{id:'fixture',name:'Invented test store'}]}/></main>);
